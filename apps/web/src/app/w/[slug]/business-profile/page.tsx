import { redirect } from "next/navigation";

export default async function LegacyBusinessProfileRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/w/${slug}/settings/business-profile`);
}
