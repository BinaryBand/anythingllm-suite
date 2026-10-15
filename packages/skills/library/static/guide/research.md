Find the service's own API docs, not blog posts: use AnythingLLM's web search or browsing if you have it, or call the docs' address directly with call.

Note, for the toolkit:
- the base address (like https://api.github.com), and any other host its answers send you to (uploads, a CDN);
- how a request signs in: a key or token, and where it goes (an Authorization: Bearer header, another header, HTTP Basic, a query parameter);
- each endpoint the task needs: its method, path, required parameters, and what it answers;
- how it pages (a cursor, a page number, a Link header) and its limits (requests per minute, page size).

Many APIs publish an OpenAPI or JSON spec: call it with keep to read only the paths you need, rather than the whole spec.

Try the smallest read first with call (a GET that lists or shows one thing), with the user's key once it's saved (auth), then build up. A 401 or 403 means the key is missing, wrong, or not allowed this; a 429 means slow down.
