import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SourceText from "../../components/SourceText";
import { extractivePassage, sourceLink } from "./note-presentation";

test("source Markdown formats text while rejecting HTML, images and executable links",()=>{
  const html=renderToStaticMarkup(createElement(SourceText,{text:'**Result** [safe](https://example.com) [unsafe](javascript:alert%281%29) <script>alert(1)</script> ![tracking](https://example.com/pixel.png)'}));
  assert.match(html,/<strong>Result<\/strong>/);assert.match(html,/href="https:\/\/example.com\/"/);
  assert.doesNotMatch(html,/<script|<img|href="javascript:/);
  assert.equal(sourceLink('README.fr.md','https://github.com/a/b/blob/main/README.md'),'https://github.com/a/b/blob/main/README.fr.md');
  assert.equal(sourceLink('data:text/html,test'),undefined);
});
test("legacy excerpt recognition leaves evidence and original-language text intact",()=>{
  const raw='The source states: “# Модель **результат**”';
  assert.equal(extractivePassage(raw),'# Модель **результат**');
  assert.equal(raw,'The source states: “# Модель **результат**”');
});
