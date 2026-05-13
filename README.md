# mokkapi

Local-first desktop app for mocking HTTP APIs.

`mokkapi` helps you stand in for external services during development, testing, demos, and QA. You can spin up local mock servers, define endpoints and response variants, inspect incoming traffic, and iterate from a desktop UI instead of wiring temporary servers by hand.

## Why use mokkapi?

- Replace third-party APIs during local development.
- Simulate different backend scenarios without changing application code.
- Inspect exactly what your app is sending.
- Import an OpenAPI spec and turn it into a working mock quickly.
- Keep everything local: service definitions, certificates, and request history.

## Quick setup

### Option 1: install the latest release

If you just want to use `mokkapi`, download the latest release from the repository Releases page and install the build for your platform.

- Windows: installer or portable build
- macOS: DMG
- Linux: AppImage or DEB

### Option 2: run from source

If you want to develop locally or test the latest code, run it from source.

### Requirements

- Node.js 22+
- npm 10+

### Run locally

```bash
npm ci
npm run dev
```

That opens the Electron app in development mode.

## First 5 minutes

1. Open the app.
2. Create a new service.
3. Choose a local port.
4. Add an endpoint such as `GET /users/:id`.
5. Add a response variant with a status code and JSON body.
6. Press `Start` on the service.
7. Use the built-in Test Client or your own app to call the endpoint.
8. Open Request Inspector to see the incoming request and the mock response.

## What you can do

### Build mock services visually

- Create and manage multiple local mock services.
- Start and stop each service from the UI.
- Define endpoints by HTTP method and path.
- Support parameterized paths such as `/orders/:id`.

### Create realistic responses

- Add multiple response variants per endpoint.
- Configure status code, delay, headers, body content, and body type.
- Switch body type between JSON, XML, text, and binary payload mode.
- Force a specific variant when you need deterministic behavior.
- Group variants by scenario to simulate different backend states.

### Match requests with more control

- Match by method and path.
- Match by headers.
- Match by query parameters.
- Match by JSON request body rules.

### Generate dynamic content

Response bodies support Handlebars templates, so mocks can react to request data and generate realistic payloads.

Examples:

```handlebars
{
  "id": "{{request.params.id}}",
  "email": "{{faker.email}}",
  "createdAt": "{{now}}"
}
```

Useful values include:

- `{{request.params.id}}`
- `{{request.query.foo}}`
- `{{request.body.someField}}`
- `{{faker.uuid}}`
- `{{faker.name}}`
- `{{faker.email}}`
- `{{now}}`
- `{{nowMs}}`

### Inspect real traffic

- Capture requests received by running mock services.
- Review request method, path, status, and duration.
- Inspect request headers and body.
- Inspect response headers and body.
- Filter history locally.

### Test without leaving the app

- Send HTTP requests from the built-in Test Client.
- Configure method, URL, headers, and body.
- Inspect the returned status, headers, and body.
- Avoid browser CORS issues because requests are sent through Electron.

### Bootstrap from OpenAPI

- Import OpenAPI 3 specs in YAML or JSON.
- Use drag-and-drop or file picker.
- Generate services, endpoints, and starter response variants from the spec.

## Main areas of the app

### Services

This is the main editing area.

- Create services.
- Add endpoints.
- Edit variants.
- Set response rules.
- Start and stop listeners.

### Request Inspector

Use it to understand what your app actually sent and what the mock returned.

### Test Client

Use it to manually hit your local mock endpoints.

### Imports

Use it to bring in an OpenAPI 3 file and generate a starting point.

### Settings

Current settings include:

- Theme selection.
- Workspace folder access.
- Default port base.
- Request history retention.
- Local CA path and regeneration.

## Local-first by design

`mokkapi` stores its workspace data locally by default in:

```text
~/mokkapi-workspace
```

That workspace contains:

- `services/` for mock service definitions.
- `history.sqlite` for request history.
- `certs/` for local CA and generated certificate files.

This keeps your mocking workflow self-contained and easy to back up or inspect.

## Download or build

If this repository has GitHub Releases enabled, the easiest path for most users is to download a packaged build from the latest release.

If you want to run it from source:

```bash
npm ci
npm run dev
```

If you want to create production assets locally:

```bash
npm run build
```

If you want to generate desktop distribution artifacts locally:

```bash
npm run dist
```

## Tech stack

- Electron
- Angular
- Fastify
- SQLite
- Handlebars
- Faker
- Tailwind CSS

## Status

`mokkapi` is under active development and currently focused on local API mocking workflows.

Unsigned builds can trigger OS warnings on Windows or macOS until code signing is added.
