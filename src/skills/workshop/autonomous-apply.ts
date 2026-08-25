import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { listWorkshopAuthoredSkillNames } from "./ownership.js";
import { applySkillProposal } from "./service.js";
import { updateSkillProposalRecord } from "./store.js";
import type { SkillProposalReadResult, SkillProposalRecord } from "./types.js";

const USER_AUTHORED_PENDING_REASON = "user-authored skill; awaiting operator review";

type AutonomousSkillProposal = Pick<SkillProposalReadResult, "record" | "revisionHash">;

type AutonomousSkillProposalResult =
  | { status: "pending"; record: SkillProposalRecord }
  | { status: "applied"; record: SkillProposalRecord; targetSkillFile: string };

export async function applyAutonomousSkillProposal(params: {
  workspaceDir: string;
  agentId?: string;
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  eventActor?: Parameters<typeof applySkillProposal>[0]["eventActor"];
  proposal: AutonomousSkillProposal;
  reason: string;
}): Promise<AutonomousSkillProposalResult> {
  const store = params.env ? { env: params.env } : {};
  if (
    params.proposal.record.kind !== "create" &&
    !listWorkshopAuthoredSkillNames(params.workspaceDir, store).has(
      params.proposal.record.target.skillName,
    )
  ) {
    const record = {
      ...params.proposal.record,
      updatedAt: new Date().toISOString(),
      statusReason: USER_AUTHORED_PENDING_REASON,
    };
    await updateSkillProposalRecord({ record, store });
    return { status: "pending", record };
  }
  const applied = await applySkillProposal({
    workspaceDir: params.workspaceDir,
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.env ? { env: params.env } : {}),
    ...(params.eventActor ? { eventActor: params.eventActor } : {}),
    proposalId: params.proposal.record.id,
    expectedRevisionHash: params.proposal.revisionHash,
    reason: params.reason,
  });
  return { status: "applied", ...applied };
}
