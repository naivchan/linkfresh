import type { Config, Context } from "@netlify/functions";
import * as cheerio from "cheerio";
import { Octokit } from "@octokit/rest";
import sharp from "sharp";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export default async (req: Request, context: Context) => {
  // 1. Handle CORS Preflight OPTIONS requests
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const { url, passcode, html: rawHtml } = await req.json();

    const expectedSecret = process.env.ARCHIVE_SECRET;
    if (expectedSecret && passcode !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Invalid passcode" }),
        { status: 401, headers: corsHeaders }
      );
    }

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const targetUrl = new URL(url);
    let html = rawHtml;

    // Fetch remote HTML only if local browser DOM wasn't provided
    if (!html) {
      const res = await fetch(targetUrl.href, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch page: ${res.statusText}` }),
          { status: 400, headers: corsHeaders }
        );
      }

      html = await res.text();
    }

    const $ = cheerio.load(html);

    // Prevent embedded scripts from initiating redirects or navigation away from the archived snapshot
    $("head").prepend(`
      <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'unsafe-eval' *; navigate-to 'self';">
    `);

    const archivedDate = new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC";

    // Inject sticky header banner
    const banner = `
      <div style="background:#1a1a1a; color:#ffffff; padding:12px; font-family:sans-serif; text-align:center; font-size:14px; position:sticky; top:0; z-index:999999; border-bottom:2px solid #0066cc;">
        Archived Snapshot (${archivedDate}) &bull; <a href="${targetUrl.href}" target="_blank" rel="noopener" style="color:#66b2ff; text-decoration:underline;">View Original Source</a>
      </div>
    `;
    $("body").prepend(banner);

    // Compress & convert images to inline Base64 WebP
    const imgPromises = $("img")
      .map(async (_, el) => {
        const src = $(el).attr("src");
        if (!src || src.startsWith("data:")) return;

        try {
          const absoluteSrc = new URL(src, targetUrl.origin).href;
          const imgRes = await fetch(absoluteSrc);
          if (imgRes.ok) {
            const buffer = await imgRes.arrayBuffer();

            const compressedBuffer = await sharp(Buffer.from(buffer))
              .resize({ width: 1000, withoutEnlargement: true })
              .webp({ quality: 70 })
              .toBuffer();

            const base64 = compressedBuffer.toString("base64");
            $(el).attr("src", `data:image/webp;base64,${base64}`);
          }
        } catch (e) {
          $(el).attr("src", new URL(src, targetUrl.origin).href);
        }
      })
      .get();

    await Promise.all(imgPromises);

    // Inline external stylesheets
    const cssPromises = $('link[rel="stylesheet"]')
      .map(async (_, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        try {
          const absoluteHref = new URL(href, targetUrl.origin).href;
          const cssRes = await fetch(absoluteHref);
          if (cssRes.ok) {
            const cssText = await cssRes.text();
            const minifiedCss = cssText
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/\s+/g, " ")
              .replace(/\s*([{}:;,>+~])\s*/g, "$1")
              .trim();

            $(el).replaceWith(`<style>${minifiedCss}</style>`);
          } else {
            $(el).attr("href", new URL(href, targetUrl.origin).href);
          }
        } catch (e) {
          $(el).attr("href", new URL(href, targetUrl.origin).href);
        }
      })
      .get();

    await Promise.all(cssPromises);

    const finalHtml = $.html();

    const safeDomain = targetUrl.hostname.replace(/[^a-z0-9.-]/gi, "");
    const safePath = targetUrl.pathname.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-");
    const filePath = `public/links/${safeDomain}${safePath}.html`;

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER!,
      repo: process.env.GITHUB_REPO!,
      path: filePath,
      message: `archival: add snapshot for ${targetUrl.href} [skip ci]`,
      content: Buffer.from(finalHtml).toString("base64"),
      branch: "main",
    });

    return new Response(
      JSON.stringify({
        success: true,
        path: `/links/${safeDomain}${safePath}.html`,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
};

export const config: Config = {
  path: "/api/archive-link",
};