import {pointPath} from "./paths";
import type {UniverseCatalog} from "../universe";

export type ShareView = {point?: string; connection?: string; signal?: string; day?: string};
export function parseShareView(params: URLSearchParams): ShareView {
  const id = (key: string) => {const value=params.get(key);return value && /^[\w:.-]{1,200}$/.test(value) ? value : undefined;};
  const day=params.get("day");
  const validDay=day && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10)===day;
  return {point:id("point"),connection:id("connection"),signal:id("signal"),day:validDay ? day : undefined};
}
export function viewPath(view: ShareView, catalog: UniverseCatalog): string {
  if (!view.connection && !view.signal && !view.day) return pointPath(view.point ?? "",catalog) ?? "/";
  const params=new URLSearchParams();
  for(const key of ["point","connection","signal","day"] as const) if(view[key]) params.set(key,view[key]);
  return `/?${params}`;
}
export function referralUrl(path: string, origin = "https://symtri.com"): string {
  const url=new URL(path,origin);
  url.searchParams.set("utm_source","share");url.searchParams.set("utm_medium","referral");
  return url.toString();
}
