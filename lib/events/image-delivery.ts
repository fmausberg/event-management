// Delivery only: keep persisted URLs and the server-only upload module untouched.
export function eventImageDelivery(url: string, variant: "card" | "detail") {
  const widths = variant === "card" ? [320, 480, 640, 960] : [640, 960, 1280, 1600];
  const fallbackWidth = variant === "card" ? 640 : 1280;
  // The uploader stores unsigned, versioned res.cloudinary.com image/upload URLs.
  // Leave external, signed and already transformed URLs alone rather than break them.
  const match = /^(https?:\/\/res\.cloudinary\.com\/[^/?#]+\/image\/upload\/)((?:v\d+\/)?[^?#]+)([?#].*)?$/i.exec(url);
  const path = match?.[2];
  const plainUpload = path && !path.startsWith("s--") && !path.split("/")[0].includes(",") && !/^[a-z]{1,3}_/.test(path.split("/")[0]);
  if (!match || !plainUpload || match[3]) return { src: url };
  const quality = variant === "card" ? "eco" : "good";
  const source = (width: number) => `${match[1]}c_fill,g_center,w_${width},h_${width * 9 / 16}/q_auto:${quality}/f_auto/${path}`;
  return {
    src: source(fallbackWidth),
    srcSet: widths.map((width) => `${source(width)} ${width}w`).join(", "),
    // max-w-6xl, px-5/sm:px-8, gap-6; detail has a 360px sidebar + gap-8.
    sizes: variant === "card"
      ? "(min-width: 1152px) 346px, (min-width: 1024px) calc((100vw - 116px) / 3), (min-width: 640px) calc((100vw - 90px) / 2), calc(100vw - 42px)"
      : "(min-width: 1152px) 696px, (min-width: 1024px) calc(100vw - 456px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)",
  };
}
