export const prerender = false;
import { Resend } from 'resend';

export async function POST({ request, locals }) {
  try {
    const data = await request.json();
    const { name, email, phone, date, interest, budget, message } = data;

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, email, and message are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // In Cloudflare Pages, environment variables are available via locals.runtime.env or process.env / import.meta.env
    const apiKey = 
      locals?.runtime?.env?.RESEND_API_KEY || 
      import.meta.env.RESEND_API_KEY || 
      process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.error('RESEND_API_KEY is not defined.');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: RESEND_API_KEY is missing.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(apiKey);

    // Determine the sender address:
    // Using verified custom sending domain: mail.sbfloristry.co.uk
    const fromAddress = 
      locals?.runtime?.env?.RESEND_FROM_EMAIL || 
      import.meta.env.RESEND_FROM_EMAIL || 
      process.env.RESEND_FROM_EMAIL || 
      'SB Floristry Studio <studio@mail.sbfloristry.co.uk>';

    // Target recipient: studio@sbfloristry.co.uk (or notification target configured in env)
    const targetRecipient = 
      locals?.runtime?.env?.RESEND_TO_EMAIL || 
      import.meta.env.RESEND_TO_EMAIL || 
      process.env.RESEND_TO_EMAIL || 
      'studio@sbfloristry.co.uk';

    const formattedDate = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Flexible / To be confirmed';

    // 1. Send Notification Email to Studio
    const studioEmailHtml = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1A1A1A; line-height: 1.6; border: 1px solid #EBE7DF; padding: 32px; background-color: #FAF8F5;">
        <h2 style="font-family: Georgia, serif; font-size: 24px; color: #1A1A1A; border-bottom: 2px solid #8A6A45; padding-bottom: 12px; margin-top: 0;">
          New Studio Inquiry
        </h2>
        <p style="font-size: 14px; text-transform: uppercase; letter-spacing: 0.15em; color: #8A6A45; font-weight: bold;">
          ${interest || 'General / Bespoke Inquiry'}
        </p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 15px;">
          <tr>
            <td style="padding: 8px 0; color: #736C63; width: 140px;">Client Name:</td>
            <td style="padding: 8px 0; font-weight: bold; color: #1A1A1A;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #736C63;">Email Address:</td>
            <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #8A6A45; text-decoration: none;">${email}</a></td>
          </tr>
          ${phone ? `
          <tr>
            <td style="padding: 8px 0; color: #736C63;">Telephone:</td>
            <td style="padding: 8px 0;"><a href="tel:${phone}" style="color: #1A1A1A; text-decoration: none;">${phone}</a></td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; color: #736C63;">Event / Service Date:</td>
            <td style="padding: 8px 0; color: #1A1A1A;">${formattedDate}</td>
          </tr>
          ${budget ? `
          <tr>
            <td style="padding: 8px 0; color: #736C63;">Budget / Investment:</td>
            <td style="padding: 8px 0; font-weight: bold; color: #8A6A45;">${budget}</td>
          </tr>` : ''}
        </table>

        <div style="background-color: #FFFFFF; border-left: 3px solid #8A6A45; padding: 20px; margin: 20px 0;">
          <h4 style="margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #736C63;">Client Vision & Notes:</h4>
          <p style="margin: 0; font-size: 15px; white-space: pre-line; color: #2C2A29;">${message}</p>
        </div>

        <p style="font-size: 12px; color: #8C847A; margin-top: 32px; border-top: 1px solid #E5E0D8; padding-top: 16px;">
          Received directly from the SB Floristry web platform. Simply reply to this email to respond directly to ${name}.
        </p>
      </div>
    `;

    const { data: resendData, error: resendError } = await resend.emails.send({
      from: fromAddress,
      to: [targetRecipient],
      replyTo: `${name} <${email}>`,
      subject: `[Inquiry] ${interest || 'Bespoke Commission'} — ${name}`,
      html: studioEmailHtml,
    });

    if (resendError) {
      console.error('Resend delivery error:', resendError);
      return new Response(
        JSON.stringify({ error: resendError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: resendData?.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('API endpoint error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
