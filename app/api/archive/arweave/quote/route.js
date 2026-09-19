import { NextResponse } from 'next/server';
import { createRequire } from 'module';
const require=createRequire(import.meta.url);
const {buildAuthRequestShim,verifyAdminRequest}=require('../../../../../api/_lib/auth.cjs');
const {estimateArchiveCost}=require('../../../../../api/_lib/archive-arweave.cjs');

export async function POST(request){
  try{await verifyAdminRequest(buildAuthRequestShim(request));}
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Forbidden.'},{status:403});}
  const body=await request.json();
  const sizeBytes=Number(body?.sizeBytes);
  if(!Number.isFinite(sizeBytes)||sizeBytes<0)return NextResponse.json({error:'Valid sizeBytes required'},{status:400});
  return NextResponse.json({quote:estimateArchiveCost(sizeBytes,{arPriceUSD:Number(body?.arPriceUSD)||10})});
}
