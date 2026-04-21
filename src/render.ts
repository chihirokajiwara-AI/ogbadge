/**
 * OG Image renderer using Satori (SVG) + resvg (PNG).
 * No Puppeteer needed — runs anywhere including edge/serverless.
 */

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let fontDataCache: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontDataCache) return fontDataCache;
  // Use Inter from Google Fonts (bundled)
  try {
    const fontPath = join(__dirname, "fonts", "Inter-Regular.ttf");
    fontDataCache = (await readFile(fontPath)).buffer as ArrayBuffer;
  } catch {
    // Fallback: fetch from CDN
    const res = await fetch(
      "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2",
    );
    fontDataCache = await res.arrayBuffer();
  }
  return fontDataCache;
}

let fontBoldCache: ArrayBuffer | null = null;

async function loadFontBold(): Promise<ArrayBuffer> {
  if (fontBoldCache) return fontBoldCache;
  try {
    const fontPath = join(__dirname, "fonts", "Inter-Bold.ttf");
    fontBoldCache = (await readFile(fontPath)).buffer as ArrayBuffer;
  } catch {
    const res = await fetch(
      "https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYAZ9hiA.woff2",
    );
    fontBoldCache = await res.arrayBuffer();
  }
  return fontBoldCache;
}

export interface OgParams {
  title: string;
  subtitle?: string;
  domain?: string;
  theme?: "light" | "dark" | "gradient";
  accentColor?: string;
  imageUrl?: string;
  emoji?: string;
  watermark?: boolean; // true for free tier
  width?: number;
  height?: number;
}

export async function renderOgImage(params: OgParams): Promise<Buffer> {
  const {
    title,
    subtitle,
    domain,
    theme = "dark",
    accentColor = "#6366f1",
    emoji,
    watermark = true,
    width = 1200,
    height = 630,
  } = params;

  const bg =
    theme === "light"
      ? "#ffffff"
      : theme === "gradient"
        ? accentColor
        : "#0f172a";
  const fg = theme === "light" ? "#0f172a" : "#f8fafc";
  const subtitleColor = theme === "light" ? "#64748b" : "#94a3b8";

  const element = {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 80px",
        background:
          theme === "gradient"
            ? `linear-gradient(135deg, ${accentColor}, ${accentColor}dd, #0f172a)`
            : bg,
        fontFamily: "Inter",
      },
      children: [
        ...(emoji
          ? [
              {
                type: "div",
                props: {
                  style: { fontSize: "72px", marginBottom: "20px" },
                  children: emoji,
                },
              },
            ]
          : []),
        {
          type: "div",
          props: {
            style: {
              fontSize: title.length > 60 ? "42px" : title.length > 30 ? "52px" : "64px",
              fontWeight: 700,
              color: theme === "gradient" ? "#ffffff" : fg,
              lineHeight: 1.2,
              marginBottom: subtitle ? "16px" : "0",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
            children: title,
          },
        },
        ...(subtitle
          ? [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "28px",
                    color: theme === "gradient" ? "#ffffffcc" : subtitleColor,
                    lineHeight: 1.4,
                  },
                  children: subtitle,
                },
              },
            ]
          : []),
        ...(domain
          ? [
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "20px",
                    color: theme === "gradient" ? "#ffffff99" : subtitleColor,
                    marginTop: "auto",
                    paddingTop: "24px",
                  },
                  children: domain,
                },
              },
            ]
          : []),
        ...(watermark
          ? [
              {
                type: "div",
                props: {
                  style: {
                    position: "absolute",
                    bottom: "16px",
                    right: "24px",
                    fontSize: "14px",
                    color: theme === "light" ? "#00000033" : "#ffffff33",
                    fontWeight: 400,
                  },
                  children: "ogbadge.dev",
                },
              },
            ]
          : []),
      ],
    },
  };

  const [fontData, fontBold] = await Promise.all([loadFont(), loadFontBold()]);

  const svg = await satori(element as any, {
    width,
    height,
    fonts: [
      { name: "Inter", data: fontData, weight: 400, style: "normal" },
      { name: "Inter", data: fontBold, weight: 700, style: "normal" },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
  });
  const png = resvg.render();
  return Buffer.from(png.asPng());
}
