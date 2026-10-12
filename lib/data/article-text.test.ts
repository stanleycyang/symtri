import test from "node:test";
import assert from "node:assert/strict";
import {articleText} from "./article-text";
import {sourcePassage,hasExcerptChrome} from "./source-passage";
import {needsExcerptRepair,readableExcerptNote} from "./excerpt-note";
import type {ReadingNote} from "./enrichment";
const prose="Microsoft today has formally launched its Surface Laptop Ultra, the first in a series of developer-focused machines. The article describes the hardware, its intended users, and the development environment.";
const chrome="Mobile News Facebook X Pinterest Linkedin ReddIt Email Print Copy URL Surface-Laptop-Ultra-and-Surface-RTX-Spark-Dev-Box ";
test("article extraction keeps the body and excludes nested share controls, captions and related stories",()=>{
 const html=`<main><article class="category-social-media tag-comments"><header>Mobile News</header><div class="td-post-sharing-top"><div><a>Facebook</a> X Pinterest Linkedin ReddIt Email Print Copy URL</div></div><div class="td-post-content"><figure><img alt="tracking"><figcaption>Surface-Laptop-Ultra-and-Surface-RTX-Spark-Dev-Box</figcaption></figure><p>${prose}</p><div class="share-buttons">Share this article</div></div><aside>Related story text</aside></article></main>`;
 assert.equal(articleText(html),prose);
});
test("generic articles preserve decoded text, paragraph boundaries and inline emphasis",()=>{
 const html=`<article><p>${prose}</p><p>Research into <strong>Facebook and LinkedIn</strong> focuses on people &amp; their use of platforms.</p><nav>Next article</nav></article>`;
 const text=articleText(html);assert.ok(text.includes("\n"));assert.match(text,/Facebook and LinkedIn/);assert.match(text,/people & their/);assert.doesNotMatch(text,/Next article/);
 assert.equal(articleText(`<nav>${prose}</nav>`),"");
});
test("fallback skips flattened sharing menus and image filenames while retaining an exact passage",()=>{
 const text=chrome+prose;const quote=sourcePassage(text,"An unrelated feed headline","article");
 assert.ok(quote?.startsWith("Microsoft today"));assert.ok(text.includes(quote!));assert.ok(!hasExcerptChrome(quote!));
 assert.equal(sourcePassage(chrome.repeat(4),"", "article"),null);
 assert.equal(hasExcerptChrome("Facebook and LinkedIn are the platforms discussed in this article."),false);
 assert.equal(hasExcerptChrome("Researchers compared Facebook, Twitter, Reddit and other platforms."),false);
});
const note:ReadingNote={explanation:`The source states: “${(chrome+prose).slice(0,230)}”`,claims:[{text:"Legacy excerpt",evidence:[{sourceId:"hacker-news:fixture",quote:(chrome+prose).slice(0,230)}]}],questions:[],createdAt:"2026-10-12",sourceKind:"article",evidenceSource:"hacker-news",evidenceUrl:"https://example.org/article",evidenceAttribution:"Publisher",evidenceLicense:null,context:[],synthesisMethod:"extractive"};
test("saved contaminated notes are repaired from retained evidence without mutating the archive",()=>{
 const original=JSON.stringify(note);assert.equal(needsExcerptRepair(note),true);
 const cleaned=readableExcerptNote(note,"Feed title",chrome+prose);
 assert.match(cleaned.explanation,/states: “Microsoft today/);assert.ok((chrome+prose).includes(cleaned.claims[0].evidence[0].quote));assert.equal(JSON.stringify(note),original);
 assert.equal(needsExcerptRepair(cleaned),false);
});
test("missing clean evidence produces an honest source-link fallback instead of navigation text",()=>{
 const contaminated={...note,explanation:`The source states: “${chrome.repeat(3)}”`};
 const result=readableExcerptNote(contaminated,"Title");assert.equal(result.explanation,"");assert.deepEqual(result.claims,[]);
});
