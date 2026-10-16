Try these in order, and take the first that works:

1. **Already in the library?** A saved library function does the task in one step: run it (the library skill).
2. **An official API?** Most services that hold data or settings have one: research it (topic research), then build it in the library (its guide), which asks the user for the key and keeps the function.
3. **The site's own JSON?** A web app usually talks to its own server in JSON. While this chat's tab is signed in to it, call with auth "session": the request goes from the tab, with its session. Not signed in yet? open its sign-in page and use login yourself: a login the user saved types itself, and one they haven't is asked for on the tab's page. Don't send them to sign in on their own. Find the endpoint in the docs, or from the site's addresses, and try a GET first.
4. **Click through.** When there's no API, or it can't do the task: open, read, act. It works for what a person could do, just slower.

Mix them: research the API in the browser, sign in with the browser and then call the site's JSON, or click through the one step an API lacks.

Before changing anything (sending, deleting, buying, changing settings), read first so you know what is there, say what you're about to change, and do it once the user agrees. Reading needs no permission.
