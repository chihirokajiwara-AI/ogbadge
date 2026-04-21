/**
 * Pre-built OG image templates.
 * Each returns a Satori-compatible element tree.
 */

export interface TemplateParams {
  title: string;
  subtitle?: string;
  domain?: string;
  tag?: string;
  author?: string;
  date?: string;
  stat?: string;
  statLabel?: string;
  accentColor?: string;
  watermark?: boolean;
}

type SatoriElement = { type: string; props: Record<string, unknown> };

function watermarkNode(light: boolean): SatoriElement {
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        bottom: "16px",
        right: "24px",
        fontSize: "14px",
        color: light ? "#00000033" : "#ffffff33",
        fontWeight: 400,
      },
      children: "ogbadge.dev",
    },
  };
}

/** Blog post card — title, tag, author, date */
export function blogTemplate(p: TemplateParams): SatoriElement {
  const accent = p.accentColor || "#6366f1";
  return {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "#0f172a", padding: "60px 80px", fontFamily: "Inter",
      },
      children: [
        ...(p.tag ? [{
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", marginBottom: "24px",
            },
            children: [{
              type: "div",
              props: {
                style: {
                  background: accent, color: "#ffffff", padding: "6px 16px",
                  borderRadius: "100px", fontSize: "16px", fontWeight: 600,
                },
                children: p.tag,
              },
            }],
          },
        }] : []),
        {
          type: "div",
          props: {
            style: {
              fontSize: p.title.length > 50 ? "44px" : "56px",
              fontWeight: 700, color: "#f8fafc", lineHeight: 1.2,
              flexGrow: 1, display: "flex", alignItems: "center",
            },
            children: p.title,
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex", alignItems: "center", gap: "16px",
              borderTop: "1px solid #334155", paddingTop: "24px",
              marginTop: "auto",
            },
            children: [
              ...(p.author ? [{
                type: "div",
                props: {
                  style: { fontSize: "20px", color: "#e2e8f0", fontWeight: 600 },
                  children: p.author,
                },
              }] : []),
              ...(p.author && p.date ? [{
                type: "div",
                props: { style: { fontSize: "20px", color: "#475569" }, children: "·" },
              }] : []),
              ...(p.date ? [{
                type: "div",
                props: { style: { fontSize: "20px", color: "#94a3b8" }, children: p.date },
              }] : []),
              ...(p.domain ? [{
                type: "div",
                props: {
                  style: { fontSize: "18px", color: "#64748b", marginLeft: "auto" },
                  children: p.domain,
                },
              }] : []),
            ],
          },
        },
        ...(p.watermark ? [watermarkNode(false)] : []),
      ],
    },
  };
}

/** Stats/metric card — big number with label */
export function statsTemplate(p: TemplateParams): SatoriElement {
  const accent = p.accentColor || "#10b981";
  return {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        background: "#0f172a", padding: "60px 80px", fontFamily: "Inter",
        textAlign: "center",
      },
      children: [
        ...(p.stat ? [{
          type: "div",
          props: {
            style: {
              fontSize: "120px", fontWeight: 700, color: accent,
              lineHeight: 1,
            },
            children: p.stat,
          },
        }] : []),
        ...(p.statLabel ? [{
          type: "div",
          props: {
            style: {
              fontSize: "32px", color: "#94a3b8", marginTop: "16px",
              fontWeight: 400,
            },
            children: p.statLabel,
          },
        }] : []),
        {
          type: "div",
          props: {
            style: {
              fontSize: p.title.length > 40 ? "36px" : "48px",
              fontWeight: 700, color: "#f8fafc", marginTop: "40px",
              lineHeight: 1.2,
            },
            children: p.title,
          },
        },
        ...(p.subtitle ? [{
          type: "div",
          props: {
            style: { fontSize: "24px", color: "#64748b", marginTop: "12px" },
            children: p.subtitle,
          },
        }] : []),
        ...(p.domain ? [{
          type: "div",
          props: {
            style: {
              position: "absolute", bottom: "24px", left: "80px",
              fontSize: "18px", color: "#475569",
            },
            children: p.domain,
          },
        }] : []),
        ...(p.watermark ? [watermarkNode(false)] : []),
      ],
    },
  };
}

/** Product/launch card — gradient bg with centered content */
export function productTemplate(p: TemplateParams): SatoriElement {
  const accent = p.accentColor || "#8b5cf6";
  return {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        background: `linear-gradient(135deg, ${accent}22, ${accent}88, ${accent}22)`,
        padding: "60px 80px", fontFamily: "Inter", textAlign: "center",
      },
      children: [
        ...(p.tag ? [{
          type: "div",
          props: {
            style: {
              background: accent, color: "#ffffff", padding: "8px 24px",
              borderRadius: "100px", fontSize: "18px", fontWeight: 600,
              marginBottom: "32px",
            },
            children: p.tag,
          },
        }] : []),
        {
          type: "div",
          props: {
            style: {
              fontSize: p.title.length > 30 ? "52px" : "64px",
              fontWeight: 700, color: "#f8fafc", lineHeight: 1.2,
            },
            children: p.title,
          },
        },
        ...(p.subtitle ? [{
          type: "div",
          props: {
            style: {
              fontSize: "28px", color: "#ffffffcc", marginTop: "16px",
              lineHeight: 1.4, maxWidth: "800px",
            },
            children: p.subtitle,
          },
        }] : []),
        ...(p.domain ? [{
          type: "div",
          props: {
            style: {
              position: "absolute", bottom: "24px", left: "0", right: "0",
              fontSize: "18px", color: "#ffffff66", textAlign: "center",
            },
            children: p.domain,
          },
        }] : []),
        ...(p.watermark ? [watermarkNode(false)] : []),
      ],
    },
  };
}

/** Minimal card — clean, no distractions */
export function minimalTemplate(p: TemplateParams): SatoriElement {
  return {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "center",
        background: "#ffffff", padding: "80px 100px", fontFamily: "Inter",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              width: "48px", height: "6px",
              background: p.accentColor || "#0f172a",
              marginBottom: "32px", borderRadius: "3px",
            },
            children: "",
          },
        },
        {
          type: "div",
          props: {
            style: {
              fontSize: p.title.length > 50 ? "40px" : "52px",
              fontWeight: 700, color: "#0f172a", lineHeight: 1.3,
            },
            children: p.title,
          },
        },
        ...(p.subtitle ? [{
          type: "div",
          props: {
            style: {
              fontSize: "24px", color: "#64748b", marginTop: "16px",
              lineHeight: 1.4,
            },
            children: p.subtitle,
          },
        }] : []),
        ...(p.domain ? [{
          type: "div",
          props: {
            style: {
              position: "absolute", bottom: "32px", left: "100px",
              fontSize: "18px", color: "#94a3b8",
            },
            children: p.domain,
          },
        }] : []),
        ...(p.watermark ? [watermarkNode(true)] : []),
      ],
    },
  };
}

export const TEMPLATES: Record<string, (p: TemplateParams) => SatoriElement> = {
  blog: blogTemplate,
  stats: statsTemplate,
  product: productTemplate,
  minimal: minimalTemplate,
};
