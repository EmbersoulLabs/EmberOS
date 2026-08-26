"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CreateCampaignWizard } from "@/components/campaign/CreateCampaignWizard";

export default function CreateCampaignPage() {
  const params = useParams();
  return (
    <AppShell>
      <CreateCampaignWizard workspaceSlug={params.slug as string} />
    </AppShell>
  );
}
