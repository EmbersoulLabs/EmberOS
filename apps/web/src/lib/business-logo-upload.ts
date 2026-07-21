export const BUSINESS_LOGO_ACCEPT = "image/*";

export type BusinessLogoFile = Pick<File, "name" | "type">;
export type BusinessLogoUploadFile = File;

export type BusinessLogoSelection =
  | {
      ok: true;
      fileName: string;
      previewUrl: string;
    }
  | {
      ok: false;
      reason: "invalid_type";
    };

export type BusinessLogoUploadResponse = {
  profile: Record<string, unknown>;
  logo: string | null;
  storagePath?: string;
};

export function isAcceptedLogoFile(file: Pick<File, "type">) {
  return file.type.startsWith("image/");
}

export function validateBusinessLogo(file: Pick<File, "type">): BusinessLogoSelection["ok"] {
  return isAcceptedLogoFile(file);
}

export function createBusinessLogoSelection(
  file: BusinessLogoFile,
  createPreviewUrl: (file: BusinessLogoFile) => string
): BusinessLogoSelection {
  if (!isAcceptedLogoFile(file)) {
    return { ok: false, reason: "invalid_type" };
  }

  return {
    ok: true,
    fileName: file.name,
    previewUrl: createPreviewUrl(file),
  };
}

export async function uploadBusinessLogo(
  workspaceId: string,
  file: BusinessLogoUploadFile,
  fetcher: typeof fetch = fetch
): Promise<BusinessLogoUploadResponse> {
  const formData = new FormData();
  formData.set("file", file);

  const res = await fetcher(`/api/workspaces/${workspaceId}/business-profile/logo`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Logo upload failed");
  }
  return data as BusinessLogoUploadResponse;
}

export async function removeBusinessLogo(
  workspaceId: string,
  fetcher: typeof fetch = fetch
): Promise<BusinessLogoUploadResponse> {
  const res = await fetcher(`/api/workspaces/${workspaceId}/business-profile/logo`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Logo remove failed");
  }
  return data as BusinessLogoUploadResponse;
}
