"use client";
import {useMemo,useSyncExternalStore} from "react";
import {INTEREST_STORAGE_KEY,normalizeInterests,type InterestState} from "./interests";
const empty="";let memory="";
function snapshot(){try{return window.localStorage.getItem(INTEREST_STORAGE_KEY) ?? memory;}catch{return memory;}}
function subscribe(callback:()=>void){window.addEventListener("storage",callback);window.addEventListener("symtri:interests-change",callback);return ()=>{window.removeEventListener("storage",callback);window.removeEventListener("symtri:interests-change",callback);};}
export function updateInterests(update:(prior:InterestState)=>InterestState){
 let prior:unknown;try{prior=JSON.parse(snapshot() || "{}");}catch{prior={};}
 memory=JSON.stringify(normalizeInterests(update(normalizeInterests(prior))));
 try{window.localStorage.setItem(INTEREST_STORAGE_KEY,memory);}catch{/* Choices still work for this page. */}
 window.dispatchEvent(new Event("symtri:interests-change"));
}
export function useInterests(){
 const raw=useSyncExternalStore(subscribe,snapshot,()=>empty);
 return useMemo(()=>{try{return normalizeInterests(JSON.parse(raw || "{}"));}catch{return normalizeInterests(null);}},[raw]);
}
