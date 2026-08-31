import { processNextAiJob } from "./server/ai-jobs";
import { prisma } from "./lib/db";

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){while(true){const processed=await processNextAiJob();if(!processed)await delay(Number(process.env.AI_WORKER_POLL_MS??2000));}}
main().catch(async error=>{console.error("AI worker stopped",error);await prisma.$disconnect();process.exitCode=1;});
