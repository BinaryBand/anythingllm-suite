import basic from "./basic.js";
import captcha from "./captcha.js";
import consent from "./consent.js";
import federated from "./federated.js";
import gate from "./gate.js";
import idp from "./idp.js";
import iframe from "./iframe.js";
import otp from "./otp.js";
import passkey from "./passkey.js";
import push from "./push.js";
import shadow from "./shadow.js";
import spa from "./spa.js";
import stepup from "./stepup.js";
import totp from "./totp.js";
import twostep from "./twostep.js";
import wizard from "./wizard.js";

export const SITES = [basic, twostep, spa, totp, otp, passkey, captcha, iframe, shadow, wizard, idp, federated, push, stepup, consent, gate];

export { BASE_PORT, portOf, publicUrlOf } from "../lib/ports.js";

export const seedAll = () => SITES.forEach((s) => s.seed());
