# Workspace Guide

This sample knowledge base ships with LocalAI Workspace. Teams can replace
these documents before building their own application.

## Connect a model

Open Settings > AI Providers and configure your provider. Select an available
default chat model. The built-in Workspace guide agent uses your active
provider and its default model.

## Try the sample calculator

Open Tools, expand calculator, and choose Test / Run. Enter `a: 12`, `b: 3`,
and `operation: multiply`. The result is `36`. Supported operations are add,
subtract, multiply, and divide. Division by zero returns an error.

The calculator runs locally and does not require an AI model or network access.

## Explore skills and agents

Open Skills to read Clear writing. It demonstrates a reusable set of writing
instructions. Open Agents to run Workspace guide after configuring a model.
The agent references Clear writing, the calculator, and this knowledge base.

## Search these documents

Open Knowledge Base and preview workspace guide to read it immediately.
To make it searchable, select an embedding model in Settings > KBase, then
choose Sync / Re-index for workspace guide. Indexing and model downloads may
require additional setup depending on your provider.

## Connect the sample MCP server

Open MCP, expand DeepWiki — sample MCP, and choose Start. This remote server
provides tools for documentation about public GitHub repositories. It requires
an internet connection and is not started automatically. Use Stop to disconnect.
The Workspace guide agent does not automatically send questions to this server.

Official service documentation: https://docs.devin.ai/work-with-devin/deepwiki-mcp
