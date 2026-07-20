import { redirect } from "next/navigation";

export default async function LegacyBusinessProfileSettingsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/w/${slug}/business-profile`);
}
