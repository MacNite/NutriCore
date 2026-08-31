"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireUser } from "./session";
import { checkUrl } from "@/lib/url-guard";
import { validDateKey } from "@/lib/date";

export async function queueMealInputAction(formData:FormData){
  const user=await requireUser(); const parsed=z.object({text:z.string().trim().min(2).max(2000),sourceUrl:z.string().trim().max(500).optional(),meal:z.enum(["BREAKFAST","LUNCH","DINNER","SNACKS"]),date:z.string()}).parse(Object.fromEntries(formData));
  if(parsed.sourceUrl){const safe=await checkUrl(parsed.sourceUrl);if(!safe.ok)redirect(`/research/new?error=unsafeUrl`);}
  const input=await prisma.mealInput.create({data:{userId:user.id,text:parsed.text,sourceUrl:parsed.sourceUrl||null,meal:parsed.meal,diaryDate:new Date(`${validDateKey(parsed.date)}T00:00:00.000Z`)}});
  await prisma.aiJob.create({data:{userId:user.id,entityType:"MEAL_INPUT",entityId:input.id,mealInputId:input.id,model:process.env.AI_MODEL??process.env.OLLAMA_MODEL??"qwen3.5:4b"}});
  redirect(`/ai-review/${input.id}?queued=1`);
}

export async function reviewAiProposalAction(formData:FormData){
  const user=await requireUser();const id=String(formData.get("proposalId"));const decision=String(formData.get("decision"));
  const proposal=await prisma.aiProposal.findFirst({where:{id,job:{userId:user.id}},include:{job:true}});if(!proposal||proposal.approvalStatus!=="PENDING")throw new Error("Proposal is not awaiting review");
  await prisma.aiProposal.update({where:{id},data:{approvalStatus:decision==="accept"?"ACCEPTED":"REJECTED",accepted:decision==="accept"?proposal.proposed as Prisma.InputJsonValue:Prisma.JsonNull,reviewedAt:new Date()}});
  redirect(`/ai-review/${proposal.job.entityId}`);
}
