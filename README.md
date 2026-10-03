# Chat Archify

**English** | [简体中文](README.zh-CN.md)

Turn long conversations into interactive maps of topics, decisions, and changes in direction—with sources and optional resource links attached to each node.

Use Chat Archify for a single conversation or a project discussed across several chats. No code repository or file attachments are required. **It runs only when you explicitly ask.**

[Quick start](#quick-start) · [Reproduce the complete viewer](#reproduce-the-complete-viewer) · [Viewer options](#viewer-options) · [Limitations](#limitations-and-data-handling)

Chat Archify is an independent project, not an official Archify extension. The complete default viewer uses Archify as a separately installed dependency; a lighter renderer is available as an explicit fallback.

## What you can trace

- **Discussion branches:** the initial question, alternatives, comparisons, and conclusions.
- **Project evolution:** an initial version, added modules, parallel experiments, and releases.
- **Changes in direction:** abandoned approaches, the reasons behind them, and the next decision.
- **Follow-up discussions:** append events and evidence while retaining existing node IDs.

Each node records what happened, why it changed, its status at that time, and its sources. Links can point to documents, code, screenshots, or web pages. Without attachments, nodes still show summaries and source locations.

## Quick start

### 1. Install the skill

Download or copy this directory into your Codex skills directory, using `chat-archify` as its folder name. The resulting entry point should be:

```text
~/.codex/skills/chat-archify/SKILL.md
```

Use your configured skills directory if it differs. Copy the entire directory, including `assets/`, `scripts/`, `references/`, and `agents/`.

The included `agents/openai.yaml` sets `allow_implicit_invocation: false`. Other AI hosts may use different installation locations and may not recognize this Codex setting.

### 2. Ask for a map

For one conversation:

```text
Use $chat-archify to map this conversation.
Keep the topic branches, alternatives, rejected ideas, and final decisions.
Include sources and any relevant resource links.
```

For a project:

```text
Use $chat-archify to trace this project's evolution across its related chats.
Show how the initial version grew, where the direction changed,
and which files came from each stage.
```

To continue an existing map:

```text
Use $chat-archify to update the existing evolution.json with this new discussion.
Preserve old nodes and branches, add new decisions, and identify unresolved questions.
```

Provide a transcript export when the host cannot access the conversation. The skill cannot retrieve unavailable history on its own.

## Reproduce the complete viewer

The self-contained [fictional example](examples/interactive-demo/) includes a six-message conversation excerpt, five stages with a branch and merge, and two linked Markdown snapshots. It contains no real user or project data.

The complete build requires Python 3.9+, Node.js 18+, and Archify installed separately. Find its installed skill directory by locating `archify/SKILL.md` in your configured skills directory or installed skills list; use the parent directory containing `bin/archify.mjs`. The integration is verified with Archify `2.17.0-dev.1`; recheck the workflow and node interaction when using another version. Archify is not bundled or installed by this script ([upstream](https://github.com/tt-a1i/archify)).

Run one command from the skill directory (quote paths that contain spaces):

```sh
python scripts/build_interactive_demo.py --archify-dir "<archify-skill-directory>" --out-dir "work/portable-skill-demo"
```

Open `work/portable-skill-demo/chat-archify-demo.html`. The command copies the sample inputs, runs Archify showcase validation and delivery, checks all routes and record/viewer topology, packages the offline viewer, and runs portable Python and Node smoke tests. No dependencies are installed, no network is used, and no server is started. The navigation smoke test uses a fake DOM; it is not real-browser or visual acceptance evidence.

This demonstrates how to build a viewer from prepared sources. The AI extracts events and evidence from conversations; the scripts do not parse chat history or infer its meaning. See the [interactive workflow](references/interactive.md) for creating a real record and its sources.

## Viewer options

| | Complete interactive attachment viewer | Basic fallback viewer |
| --- | --- | --- |
| Setup | Python 3.9+, Node.js 18+, separately installed Archify | Included Python renderer |
| Nodes | Diagram-first, then a persistent reading panel beside the diagram | Details, sources, and resource references |
| Files | Embedded snapshots with clickable names, preview, download, and original-path copying | Resource links; local links may be restricted |
| Diagram | Archify pan/zoom and diagram controls | Lightweight graph with SVG export |
| Best for | Default exploration alongside saved files and excerpts | Explicit dependency-limited fallback |

Archify is external and is not bundled. The integration was tested with Archify 2.17.0-dev.1. The HTML viewer needs a browser that supports JavaScript, SVG, and Blob APIs; it does not require the Dialog API.

The complete viewer opens on the diagram alone, including on desktop. Clicking or keyboard-activating a node opens its reading panel; chapter changes preserve graph-only mode. Desktop shows the diagram beside a closable panel, while narrow screens show either the diagram or one reader. Breadcrumbs and browser back/forward restore the reading route and scroll position, and each chapter keeps its graph state. Markdown includes a formatted view, outline, raw-text toggle, download, and multiline locators. One search covers stages, file contents, and saved excerpts. File associations come from recorded artifact/evidence data; the path used to enter a file is labeled separately. The conversation index groups excerpts by recorded task and turn, shows same-source neighbors, and labels missing context. An original task opens only when the source provides an explicitly verified HTTPS `original_url`; otherwise the viewer shows the saved excerpt and offers title and task ID for manual lookup. Original file paths and technical IDs are collapsed by default.

Markdown tokenization uses the bundled Marked 17.0.5 library ([MIT license](assets/vendor/marked-LICENSE.md)); it needs no CDN or runtime installation. Tokens are rendered as controlled DOM elements. Embedded HTML is displayed as text, and remote images are not loaded automatically.

For a real project, prepare the evidence-based record, checked Archify HTML, and manifest using the [interactive workflow](references/interactive.md). The packager embeds selected snapshots into one offline HTML. If you lack Archify or Node.js, use the basic renderer only as a clearly labeled fallback:

```sh
python scripts/render.py "<output-dir>/evolution.json" --out-dir "<output-dir>"
```

The fallback produces `evolution.html`, SVG, Markdown, and a JSON copy. It does not provide the Archify diagram, embedded-file reader, unified full-text search, or turn-grouped excerpt index. The packager for the complete viewer checks every pair of connectors, node IDs, and directed edge multiplicities. It stops on crossings, overlaps, missing relationships, or routes through nodes; fix the diagram without dropping real edges.

## Records and updates

`evolution.json` stores the map independently of its viewer: nodes, relationships, sources, coverage, and unresolved questions. Existing IDs survive updates. `evolution.md` provides a readable index, while `evolution.svg` is an optional vector export.

Proposals, decisions, implementation, and verification are distinct events or states. A later event does not automatically depend on an earlier one. Inferred relationships must be labeled, and missing history remains a stated gap.

## Limitations and data handling

- **History access depends on the host.** Visible messages, supplied exports, and authorized tools define the available scope. A summary cannot reconstruct missing quotations or decisions.
- **Attachments are optional.** The JSON field `project` is retained for format compatibility; for an ordinary conversation, its title is simply the topic.
- **Sharing an attachment viewer shares its embedded files.** Snapshots do not update automatically. Blob links belong to the current page session, not a permanent sharing address.
- **Generation stays local.** The skill does not automatically upload a repository, publish a page, or send conversation content to others.
- **Validation has limits.** Structure, geometry, and file-byte checks do not prove historical accuracy or browser usability. Browser interactions still require separate verification; the existing code-level checks are not a completed browser acceptance test.
- **Documentation language differs from UI language.** These READMEs are bilingual. The bundled skill instructions, example transcript, and viewer labels are currently primarily Chinese.

This source package contains reusable code, templates, instructions, and a fictional example—not real user transcripts or project attachments.

## Repository guide

| Path | Purpose |
| --- | --- |
| [SKILL.md](SKILL.md) | Instructions for the AI agent |
| `agents/openai.yaml` | Codex name, prompt, and explicit-invocation setting |
| [Source guide](references/sources.md) | Access scope, missing records, and citations |
| [Record format](references/graph-format.md) | JSON fields, node states, and relationships |
| [Interactive guide](references/interactive.md) | Archify integration, attachments, and validation |
| `scripts/` / `assets/` | Renderers, checker, packager, and viewer templates |
| `examples/` | Fictional sample conversation and its record |

When changing the skill, use fictional transcripts to demonstrate behavior, preserve existing node IDs and evidence, and keep both READMEs aligned. Do not include private conversations or file snapshots in source contributions.
