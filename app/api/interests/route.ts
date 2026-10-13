import {getUniverseCatalog} from "@/lib/data/catalog";
import {interestNodes} from "@/lib/newsletter/interests";
export const dynamic="force-dynamic";
export async function GET(){return Response.json({nodes:interestNodes(await getUniverseCatalog())},{headers:{"Cache-Control":"no-store"}});}
