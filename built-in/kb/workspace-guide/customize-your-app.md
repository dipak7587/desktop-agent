# Customize your application

## Add your own built-ins

Before starting development or building an installer, add definitions to the
repository's built-in folder:

- agents: Markdown definitions with YAML frontmatter.
- skills: One folder per skill containing SKILL.md.
- tools: Exported TypeScript tool definitions.
- mcp: One JSON server definition per file.
- kb: One folder per knowledge base, containing Markdown or text documents.

The repository's built-in/README.md contains formats and examples. Restart
development after editing these files. Rebuild the installer to distribute
changes to installed users.

## Set your branding

Edit built-in/general.json for application name and General defaults.
Edit built-in/landing.json for the welcome heading and three suggestion cards.
These defaults apply to a new installation's user data. Existing users retain
their saved settings. The installer name and app identity are configured
separately in package.json.

## Built-in and personal content

Bundled originals appear in the Built-in group of each matching section.
They cannot be edited, moved, or deleted inside the installed application.
Teams change the originals in the source folder before their next build.
Users can create their own separate definitions with the application's normal
creation controls. Personal definitions remain editable.

## Credentials and connections

Keep account credentials out of the built-in folder. Each user configures
their own model provider and any required connection credentials. A bundled
MCP definition makes a server visible; it does not install external commands
or guarantee that a remote service is available.
