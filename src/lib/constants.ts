// Exact list of 18 participants as required (preserving exact spelling and capitalization)
export const PARTICIPANTS = [
  { id: "p1", name: "Qais Alhadeed" },
  { id: "p2", name: "Mohammad Alshourati" },
  { id: "p3", name: "Mohammad Darras" },
  { id: "p4", name: "Hamza Darawi" },
  { id: "p5", name: "Zeina Darawi" },
  { id: "p6", name: "JOEL" },
  { id: "p7", name: "Yara Brj" },
  { id: "p8", name: "Leya Alkhateeb" },
  { id: "p9", name: "Nard" },
  { id: "p10", name: "Sanad" },
  { id: "p11", name: "G_karkar4" },
  { id: "p12", name: "Shammas" },
  { id: "p13", name: "Ghazal" },
  { id: "p14", name: "Jude" },
  { id: "p15", name: "Malak" },
  { id: "p16", name: "Sarah" },
  { id: "p17", name: "Wasan" },
  { id: "p18", name: "Michooo" },
] as const;

export type ParticipantId = (typeof PARTICIPANTS)[number]["id"];
export type ParticipantName = (typeof PARTICIPANTS)[number]["name"];

export const APP_CONFIG = {
  EVENT_TITLE: "THE MAGIC OF SECRET SANTA",
  SUBTITLE: "A little mystery. A lot of Christmas magic.",
  PRIMARY_CTA: "Discover Your Secret Santa",
  CHRISTMAS_DATE_ISO: "2024-12-25T00:00:00.000Z",
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_PASSWORD || "SantaMagic2024!",
};
