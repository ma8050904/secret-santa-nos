/**
 * Server-side device and user-agent parsing utilities.
 * Extracts human-readable device model, operating system, and browser information.
 */

export interface ParsedDeviceInfo {
  deviceModel: string;
  os: string;
  browser: string;
  summary: string;
}

export function parseUserAgentDetails(ua: string | null | undefined): ParsedDeviceInfo {
  if (!ua || typeof ua !== "string") {
    return {
      deviceModel: "Unknown Device",
      os: "Unknown OS",
      browser: "Unknown Browser",
      summary: "Unknown Device",
    };
  }

  // OS Detection
  let os = "Unknown OS";
  if (/iPhone/i.test(ua)) {
    const match = ua.match(/OS ([\d_]+)/);
    os = match ? `iOS ${match[1].replace(/_/g, ".")}` : "iOS";
  } else if (/iPad/i.test(ua)) {
    const match = ua.match(/OS ([\d_]+)/);
    os = match ? `iPadOS ${match[1].replace(/_/g, ".")}` : "iPadOS";
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/);
    os = match ? `Android ${match[1]}` : "Android";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = "Windows 10/11";
  } else if (/Windows NT/i.test(ua)) {
    os = "Windows";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  // Device Model
  let deviceModel = "Desktop / PC";
  if (/iPhone/i.test(ua)) {
    deviceModel = "iPhone";
  } else if (/iPad/i.test(ua)) {
    deviceModel = "iPad";
  } else if (/Android/i.test(ua)) {
    const match = ua.match(/;\s*([^;]+?)\s*(?:Build|\))/i);
    deviceModel =
      match && !match[1].startsWith("Linux") && !match[1].startsWith("Android")
        ? match[1].trim()
        : "Android Mobile";
  } else if (/Macintosh/i.test(ua)) {
    deviceModel = "Mac";
  } else if (/Windows/i.test(ua)) {
    deviceModel = "Windows PC";
  }

  // Browser Detection
  let browser = "Web Browser";
  if (/SamsungBrowser\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/SamsungBrowser\/([\d.]+)/i);
    browser = match ? `Samsung Internet ${match[1].split(".")[0]}` : "Samsung Internet";
  } else if (/Edg\/([\d.]+)/i.test(ua)) {
    const match = ua.match(/Edg\/([\d.]+)/i);
    browser = match ? `Edge ${match[1].split(".")[0]}` : "Edge";
  } else if (/Chrome\/|CriOS\//i.test(ua) && !/Edg\//i.test(ua)) {
    const match = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/i);
    browser = match ? `Chrome ${match[1].split(".")[0]}` : "Chrome";
  } else if (/Safari\//i.test(ua) && !/Chrome|CriOS/i.test(ua)) {
    const match = ua.match(/Version\/([\d.]+)/i);
    browser = match ? `Safari ${match[1].split(".")[0]}` : "Safari";
  } else if (/Firefox\//i.test(ua)) {
    const match = ua.match(/Firefox\/([\d.]+)/i);
    browser = match ? `Firefox ${match[1].split(".")[0]}` : "Firefox";
  }

  const summary = `${deviceModel} (${os}) • ${browser}`;

  return { deviceModel, os, browser, summary };
}
