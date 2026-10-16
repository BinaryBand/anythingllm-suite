// Where each site listens, and its public address behind cloudflared. The offsets of the sites that
// others need to find (the sign-in provider and its app) are here, so neither imports the other.

export const BASE_PORT = Number(process.env.LAB_BASE_PORT || 4100);
export const OFFSETS = { idp: 11, federated: 12, push: 13, stepup: 14, consent: 15, gate: 16 };
export const portOf = (site) => BASE_PORT + site.offset;
/** The site's address behind the tunnel, from LAB_PUBLIC_URL ("https://lab-{name}.example.com"), or null. */
export const publicUrlOf = (site) => (process.env.LAB_PUBLIC_URL ? process.env.LAB_PUBLIC_URL.replace("{name}", site.name) : null);
