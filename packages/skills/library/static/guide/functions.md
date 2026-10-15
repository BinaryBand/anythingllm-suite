A function is plain JavaScript that defines one async function, main. It runs in a small engine of its own: there is no require, no fetch, no files and no process, only its input and kit.

```js
async function main(input, kit) {
  const answer = await kit.http({ path: `/repos/${input.repo}/issues`, params: { state: "open" } });
  if (!answer.ok) throw new Error(`the API answered ${answer.status}`);
  return answer.body.map((issue) => ({ number: issue.number, title: issue.title }));
}
```

- input is the JSON the run was given; return JSON. Keep the answer to what the user needs (at most 64 KB as JSON): pick fields, count instead of listing.
- Throw an Error to fail; its message and line are shown.
- A function stops at its time limit, and when it uses too much memory.
- Don't put a key, a token or a password in a function: kit adds them as it sends.
