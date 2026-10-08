import { legacyToolSource } from './legacy';
import { librarySchema } from '../../../shared/schemas';
import ts from 'typescript';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { createRequire, builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  generateToolSource,
  toolDefinitionSchema,
  type ToolInputDefinition,
  type ToolImportFormat,
  type ToolAnalysis,
} from '../../../shared/tool-definition';

const moduleRequire = createRequire(import.meta.url);
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function formatToolSource(source: string) {
  const file = syntaxTree(source);
  return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(file);
}
function syntaxTree(source: string) {
  if (source.length > 2_000_000) throw new Error('Tool source exceeds 2 MB');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: 'tool.ts',
  });
  const errors =
    result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length)
    throw new Error(
      errors
        .map((d) => {
          const position =
            d.file && d.start !== undefined
              ? d.file.getLineAndCharacterOfPosition(d.start)
              : undefined;
          return `${position ? `Line ${position.line + 1}: ` : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
        })
        .join('\n'),
    );
  return ts.createSourceFile('tool.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
export function validateHookSource(source: string) {
  if (!source.trim()) throw new Error('Add JavaScript or TypeScript hook code before saving');
  if (source.length > 2_000_000) throw new Error('Hook source exceeds 2 MB');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
    fileName: 'hook.ts',
  });
  const errors =
    result.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  if (errors.length)
    throw new Error(
      errors
        .map((diagnostic) => {
          const position =
            diagnostic.file && diagnostic.start !== undefined
              ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
              : undefined;
          return `${position ? `Line ${position.line + 1}: ` : ''}${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
        })
        .join('\n'),
    );
}
function key(node: ts.PropertyName) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  throw new Error('Use static property names in tool metadata and input schemas');
}
function objectFields(node: ts.Expression) {
  if (!ts.isObjectLiteralExpression(node))
    throw new Error('Tool options and schemas must be static objects');
  const result = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property))
      throw new Error('Use explicit properties in tool options and schemas');
    const name = key(property.name);
    if (result.has(name)) throw new Error(`Duplicate parameter/property: ${name}`);
    result.set(name, property.initializer);
  }
  return result;
}
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((n) => literal(n as ts.Expression));
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries([...objectFields(node)].map(([k, v]) => [k, literal(v)]));
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Date' &&
    node.arguments?.length === 1
  ) {
    const value = literal(node.arguments[0]);
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
      throw new Error('Invalid date default');
    return new Date(value);
  }
  throw new Error('Use literal values in tool names, descriptions, enums, and defaults');
}

/** Interprets only known Zod AST operations, never imported JavaScript or schema callbacks. */
export function analyzeToolSource(source: string): ToolAnalysis {
  const file = syntaxTree(source);
  const constants = new Map<string, ts.Expression>();
  let toolBinding = '',
    zodBinding = '';
  let advancedImports = false;
  let extraStatements = false;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier))
        throw new Error('Invalid module declaration');
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('://'))
        throw new Error(
          `Import ${specifier} is unsupported. Use installed packages or Node built-ins.`,
        );
      if (!builtinModules.includes(specifier.replace(/^node:/, ''))) {
        try {
          moduleRequire.resolve(specifier);
        } catch {
          throw new Error(`Import does not resolve: ${specifier}`);
        }
      }
      if (statement.importClause?.isTypeOnly) {
        advancedImports = true;
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const entry of bindings.elements) {
          if (entry.isTypeOnly) {
            advancedImports = true;
            continue;
          }
          const original = entry.propertyName?.text ?? entry.name.text;
          if (entry.propertyName || (original !== 'tool' && original !== 'z'))
            advancedImports = true;
          if (
            ['langchain/tools', 'langchain', '@langchain/core/tools'].includes(specifier) &&
            original === 'tool'
          )
            toolBinding = entry.name.text;
          if (specifier === 'zod' && original === 'z') zodBinding = entry.name.text;
        }
      } else if (bindings && ts.isNamespaceImport(bindings) && specifier === 'zod')
        zodBinding = bindings.name.text;
      if (!['langchain/tools', 'langchain', '@langchain/core/tools', 'zod'].includes(specifier))
        extraStatements = true;
    } else if (ts.isVariableStatement(statement)) {
      for (const entry of statement.declarationList.declarations)
        if (ts.isIdentifier(entry.name) && entry.initializer)
          constants.set(entry.name.text, entry.initializer);
    } else if (!ts.isEmptyStatement(statement)) extraStatements = true;
  }
  if (!toolBinding || !zodBinding)
    throw new Error('Import tool from langchain/tools and z from zod');
  const resolve = (node: ts.Expression, visited = new Set<string>()): ts.Expression => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return resolve(node.expression, visited);
    if (ts.isIdentifier(node) && constants.has(node.text)) {
      if (visited.has(node.text)) throw new Error('Circular schema reference');
      visited.add(node.text);
      return resolve(constants.get(node.text)!, visited);
    }
    return node;
  };
  const candidates: { name: string; call: ts.CallExpression }[] = [];
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const init = resolve(declaration.initializer);
      if (
        ts.isCallExpression(init) &&
        ts.isIdentifier(init.expression) &&
        init.expression.text === toolBinding
      )
        candidates.push({ name: declaration.name.text, call: init });
    }
  }
  if (candidates.length !== 1) throw new Error('Export exactly one LangChain tool(...) per file');
  const { name: exportName, call } = candidates[0];
  if (call.arguments.length !== 2) throw new Error('tool() needs an implementation and options');
  const implementation = resolve(call.arguments[0]);
  if (!ts.isArrowFunction(implementation) && !ts.isFunctionExpression(implementation))
    throw new Error('Tool implementation must be a function (inline or a const function)');
  const options = objectFields(resolve(call.arguments[1]));
  if (!options.has('name') || !options.has('description') || !options.has('schema'))
    throw new Error('Tool name, description, and schema are required');
  const name = literal(resolve(options.get('name')!));
  const description = literal(resolve(options.get('description')!));
  if (typeof name !== 'string' || !identifier.test(name))
    throw new Error('Tool names use letters, numbers, and underscores, without spaces');
  if (typeof description !== 'string' || !description.trim())
    throw new Error('Description is required');
  let advancedSchema = false;
  const schemaNode = resolve(options.get('schema')!);
  const evaluateSchema = (expression: ts.Expression, depth = 0): z.ZodType => {
    if (depth > 40) throw new Error('Input schema is too deeply nested');
    const node = resolve(expression);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
      throw new Error('Use a Zod schema expression');
    const receiver = node.expression.expression;
    const method = node.expression.name.text;
    const args = node.arguments;
    if (ts.isIdentifier(receiver) && receiver.text === zodBinding) {
      switch (method) {
        case 'string':
          return z.string();
        case 'number':
          return z.number();
        case 'boolean':
          return z.boolean();
        case 'date':
          return z.date();
        case 'any':
          return z.any();
        case 'unknown':
          advancedSchema = true;
          return z.unknown();
        case 'object': {
          if (!args[0]) throw new Error('z.object needs a shape');
          const fields = objectFields(resolve(args[0]));
          const shape = Object.fromEntries(
            [...fields].map(([k, v]) => {
              if (!identifier.test(k)) throw new Error(`Invalid parameter name: ${k}`);
              return [k, evaluateSchema(v, depth + 1)];
            }),
          );
          return z.object(shape);
        }
        case 'array':
          if (!args[0]) throw new Error('z.array needs an item schema');
          return z.array(evaluateSchema(args[0], depth + 1));
        case 'record':
          if (args.length !== 2) throw new Error('Use z.record(keySchema, valueSchema)');
          return z.record(
            evaluateSchema(args[0], depth + 1) as z.ZodString,
            evaluateSchema(args[1], depth + 1),
          );
        case 'enum': {
          const values = args[0] && literal(resolve(args[0]));
          if (!Array.isArray(values) || !values.length || values.some((v) => typeof v !== 'string'))
            throw new Error('Enum inputs need string values');
          return z.enum(values as [string, ...string[]]);
        }
        case 'literal':
          advancedSchema = true;
          return z.literal(literal(args[0]) as string);
        case 'union': {
          advancedSchema = true;
          const alternatives = resolve(args[0]);
          if (!ts.isArrayLiteralExpression(alternatives) || alternatives.elements.length < 2)
            throw new Error('z.union needs schemas');
          return z.union(
            alternatives.elements.map((e) => evaluateSchema(e as ts.Expression, depth + 1)) as [
              z.ZodType,
              z.ZodType,
              ...z.ZodType[],
            ],
          );
        }
        default:
          throw new Error(`Unsupported Zod schema operation: z.${method}`);
      }
    }
    const base = evaluateSchema(receiver, depth + 1);
    switch (method) {
      case 'optional':
        return base.optional();
      case 'nullable':
        advancedSchema = true;
        return base.nullable();
      case 'describe':
        return base.describe(String(literal(args[0])));
      case 'default': {
        const value = literal(resolve(args[0]));
        base.parse(value);
        return base.default(value);
      }
      case 'min':
      case 'max': {
        advancedSchema = true;
        const limit = literal(args[0]);
        if (typeof limit !== 'number') throw new Error('Schema bounds must be numbers');
        if (
          base instanceof z.ZodString ||
          base instanceof z.ZodNumber ||
          base instanceof z.ZodArray
        )
          return base[method](limit);
        throw new Error(`Invalid ${method} constraint`);
      }
      case 'int':
        advancedSchema = true;
        if (!(base instanceof z.ZodNumber)) throw new Error('int() requires a number');
        return base.int();
      case 'positive':
      case 'nonnegative':
        advancedSchema = true;
        if (!(base instanceof z.ZodNumber)) throw new Error(`${method} requires a number`);
        return base[method]();
      case 'strict':
      case 'passthrough':
        advancedSchema = true;
        if (!(base instanceof z.ZodObject)) throw new Error(`${method} requires an object`);
        return base[method]();
      case 'refine':
      case 'superRefine':
      case 'transform': {
        advancedSchema = true;
        if (
          !args[0] ||
          (!ts.isArrowFunction(resolve(args[0])) && !ts.isFunctionExpression(resolve(args[0])))
        )
          throw new Error('Use a function for schema callbacks');
        return base;
      }
      default:
        throw new Error(`Unsupported Zod schema method: ${method}`);
    }
  };
  const schema = evaluateSchema(schemaNode);
  if (!(schema instanceof z.ZodObject))
    throw new Error('Tool input schema must be a z.object(...)');
  const inputSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  // Date instances cannot cross IPC; test/invocation hydrates ISO strings before .invoke().
  const inputs: ToolInputDefinition[] = [];
  for (const [inputName, shape] of Object.entries(schema.shape)) {
    let base = shape as z.ZodType;
    let defaultValue: unknown;
    while (
      base instanceof z.ZodOptional ||
      base instanceof z.ZodDefault ||
      base instanceof z.ZodNullable
    ) {
      if (base instanceof z.ZodDefault) defaultValue = base.def.defaultValue;
      base = base.unwrap() as z.ZodType;
    }
    const type =
      base instanceof z.ZodString
        ? 'string'
        : base instanceof z.ZodNumber
          ? 'number'
          : base instanceof z.ZodBoolean
            ? 'boolean'
            : base instanceof z.ZodArray
              ? 'array'
              : base instanceof z.ZodObject || base instanceof z.ZodRecord
                ? 'object'
                : base instanceof z.ZodEnum
                  ? 'enum'
                  : base instanceof z.ZodDate
                    ? 'date'
                    : base instanceof z.ZodAny
                      ? 'any'
                      : undefined;
    if (!type) {
      advancedSchema = true;
      continue;
    }
    if (base instanceof z.ZodArray && !(base.element instanceof z.ZodAny)) advancedSchema = true;
    if (base instanceof z.ZodObject) advancedSchema = true;
    if (base instanceof z.ZodRecord && !(base.valueType instanceof z.ZodAny)) advancedSchema = true;
    if (type === 'date')
      (inputSchema.properties as Record<string, unknown>)[inputName] = {
        type: 'string',
        format: 'date-time',
        ...(defaultValue === undefined ? {} : { default: (defaultValue as Date).toISOString() }),
      };
    inputs.push({
      name: inputName,
      type,
      required: !shape.isOptional(),
      description: shape.description,
      ...(defaultValue === undefined
        ? {}
        : {
            defaultValue: defaultValue instanceof Date ? defaultValue.toISOString() : defaultValue,
          }),
      ...(base instanceof z.ZodEnum ? { enumValues: Object.values(base.enum) as string[] } : {}),
    });
  }
  const arrow = implementation as ts.ArrowFunction | ts.FunctionExpression;
  let body = ts.isBlock(arrow.body)
    ? arrow.body.getText(file).slice(1, -1).trim()
    : `return ${arrow.body.getText(file)};`;
  const parameter = arrow.parameters[0];
  let builderSafe =
    !advancedSchema &&
    !extraStatements &&
    !advancedImports &&
    options.size === 3 &&
    toolBinding === 'tool' &&
    zodBinding === 'z' &&
    constants.size === 1 &&
    arrow.parameters.length <= 1;
  if (parameter && ts.isObjectBindingPattern(parameter.name)) {
    const names = parameter.name.elements;
    if (
      names.some(
        (binding) =>
          binding.propertyName ||
          binding.initializer ||
          binding.dotDotDotToken ||
          !ts.isIdentifier(binding.name),
      )
    )
      builderSafe = false;
  } else if (parameter && ts.isIdentifier(parameter.name)) {
    const statements = ts.isBlock(arrow.body) ? arrow.body.statements : [];
    const first = statements[0];
    const declaration =
      first && ts.isVariableStatement(first) ? first.declarationList.declarations[0] : undefined;
    if (
      declaration &&
      ts.isObjectBindingPattern(declaration.name) &&
      declaration.initializer &&
      ts.isIdentifier(declaration.initializer) &&
      declaration.initializer.text === parameter.name.text
    ) {
      body = ts.isBlock(arrow.body)
        ? arrow.body
            .getText(file)
            .slice(first.end - arrow.body.getStart(file), -1)
            .trim()
        : body;
      // Generated destructuring is removable only if the argument isn't used again.
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        body,
      );
      while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken)
        if (
          scanner.getToken() === ts.SyntaxKind.Identifier &&
          scanner.getTokenText() === parameter.name.text
        )
          builderSafe = false;
    } else builderSafe = false;
  }
  if (!body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim())
    throw new Error('Add function implementation logic');
  const definition = { name, description, inputs, functionBody: body };
  const checked = builderSafe ? toolDefinitionSchema.safeParse(definition) : undefined;
  return {
    source: formatToolSource(source),
    name,
    description,
    exportName,
    inputSchema,
    advanced: !checked?.success,
    ...(checked?.success ? { definition: checked.data } : {}),
    checks: [
      'Tool name valid',
      'Description present',
      'Input schema valid',
      'Function implementation present',
      'TypeScript syntax valid',
      'Imports resolve',
    ],
  };
}

export function convertToolSource(raw: string, format: ToolImportFormat): ToolAnalysis {
  if (format === 'typescript') return analyzeToolSource(raw);
  let value: unknown;
  if (format === 'json') value = JSON.parse(raw);
  else if (format === 'yaml') value = parseYaml(raw);
  else {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(raw);
    if (frontmatter) {
      value = parseYaml(frontmatter[1]);
      if (value && typeof value === 'object') value = { ...value, function: frontmatter[2].trim() };
    } else {
      const name = /^Name:\s*(.+)$/im.exec(raw)?.[1]?.trim();
      const description = /\bDescription:\s*([\s\S]*?)(?=\n##\s|$)/i.exec(raw)?.[1]?.trim();
      const input = /##\s+Input\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(raw)?.[1] ?? '{}';
      const functionBody = /##\s+Function\s*\n([\s\S]*)$/i
        .exec(raw)?.[1]
        ?.trim()
        .replace(/^```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)\n```$/, '$1');
      value = {
        name,
        description,
        input: parseYaml(
          input.replace(
            /^([ \t]*)-\s+(type|required|description|defaultValue|enumValues):/gm,
            '$1  $2:',
          ),
        ),
        function: functionBody,
      };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tool definition must be an object');
  const entry = value as Record<string, unknown>;
  if (entry.toolConfig && typeof entry.toolConfig === 'object') {
    const legacy = librarySchema.parse({
      ...entry,
      id: 'import',
      content: entry.function ?? entry.content ?? '',
    });
    if (legacy.toolConfig?.type === 'javascript' || legacy.toolConfig?.type === 'api')
      return analyzeToolSource(legacyToolSource(legacy));
  }
  const inputs = Array.isArray(entry.inputs)
    ? entry.inputs
    : entry.input && typeof entry.input === 'object' && !Array.isArray(entry.input)
      ? Object.entries(entry.input).map(([name, config]) => {
          if (!config || typeof config !== 'object' || Array.isArray(config))
            throw new Error(`Invalid input ${name}`);
          return { ...config, name };
        })
      : [];
  const definition = toolDefinitionSchema.parse({
    name: entry.name,
    description: entry.description,
    inputs,
    functionBody: entry.functionBody ?? entry.function ?? entry.content,
  });
  return analyzeToolSource(generateToolSource(definition));
}

/** Resolution base for the approved child process, including packaged Electron applications. */
export const toolModuleBase = fileURLToPath(import.meta.url);
