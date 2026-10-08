/**
 * Envío de correo institucional.
 *
 * Deliberadamente escueto y deliberadamente honesto: mientras `SMTP_URL` no
 * esté definida, `sendMail` NO finge un envío. Devuelve `configured: false` y
 * quien llama registra el aviso como pendiente de entrega. TFU todavía no ha
 * creado los buzones institucionales ni entregado credenciales SMTP, y un
 * «enviado» falso en el panel es peor que un «pendiente» verdadero.
 *
 * `nodemailer` se carga de forma perezosa y opcional, igual que el motor de
 * PDF: un servidor sin la dependencia arranca sin problema.
 */
import { config } from '../config.js';

export type MailResult = { configured: boolean; ok: boolean; detail?: string };

let transportPromise: Promise<any> | null = null;

async function getTransport(): Promise<any> {
  if (!transportPromise) {
    transportPromise = (async () => {
      const moduleName = ['node', 'mailer'].join('');
      const mod = (await import(/* @vite-ignore */ moduleName)) as {
        createTransport: (url: string) => unknown;
      };
      return mod.createTransport(config.mail.smtpUrl);
    })();
  }
  return transportPromise;
}

export async function sendMail(input: {
  to: string[];
  subject: string;
  text: string;
}): Promise<MailResult> {
  // Los dos motivos se informan juntos cuando concurren: saber que falta SMTP
  // no sirve de nada si además el aviso no tiene a quién ir.
  const motivos: string[] = [];
  if (!config.mail.smtpUrl) {
    motivos.push('SMTP_URL no está definida');
  }
  if (input.to.length === 0) {
    motivos.push('el aviso no tiene destinatario resoluble (falta el expediente de faculty del curso, un profesor con rol docente en Moodle o ACADEMIC_CONTACT_EMAIL)');
  }
  if (motivos.length > 0) {
    return {
      configured: false,
      ok: false,
      detail: `${motivos.join('; ')}. El aviso queda registrado sin enviar.`
    };
  }
  try {
    const transport = await getTransport();
    await transport.sendMail({
      from: config.mail.from,
      to: input.to.join(', '),
      subject: input.subject,
      text: input.text
    });
    return { configured: true, ok: true };
  } catch (error) {
    transportPromise = null;
    return {
      configured: true,
      ok: false,
      detail: error instanceof Error ? error.message : 'Fallo de envío'
    };
  }
}
