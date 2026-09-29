export type BrandAsset = {
  id: string;
  brand_id: string;
  kind: "logo" | "reference" | "screenshot";
  filename: string;
  mime_type: string;
  signedUrl: string;
};
