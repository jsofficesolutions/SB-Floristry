export const prerender = false;

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { Resend } from 'resend';
import { services, calculateLeadTier } from '../../config/services';

const EnquirySchema = z.object({
  // Honeypot
  website_hp: z.string().max(0, 'Bot detected').optional().or(z.literal('')),

  // Service selection
  service: z.string().min(1, 'Please select an occasion or service'),

  // Step II: Event details
  eventDate: z.string().optional(),
  seasonalTiming: z.string().optional(),
  venueName: z.string().optional(),
  guestCount: z.string().optional(),
  plannerName: z.string().optional(),

  // Sympathy branch details
  sympathyDate: z.string().optional(),
  funeralDirector: z.string().optional(),
  tributeStyle: z.string().optional(),
  memorialFloralWishes: z.string().optional(),

  // Step III: Budget
  budgetBand: z.string().optional(),
  budget_fallback: z.string().optional(),

  // Step IV: Vision & contact
  moodWords: z.array(z.string()).optional().default([]),
  moodboardUrl: z.string().url().optional().or(z.literal('')),
  message: z.string().min(5, 'Please share a brief note about your celebration or vision'),
  referralSource: z.string().optional(),

  name: z.string().min(2, 'Please provide your name'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(6, 'Please provide a contact telephone number'),
  contactTime: z.string().optional().default('morning')
});

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const rawData = await request.json();

    // 1. Zod Validation
    const validationResult = EnquirySchema.safeParse(rawData);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.errors.map((e) => e.message).join('. ');
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = validationResult.data;

    // Honeypot bot protection
    if (data.website_hp && data.website_hp.length > 0) {
      console.warn('Honeypot triggered in enquiry form submission.');
      return new Response(
        JSON.stringify({ success: true, redirectUrl: '/enquire/received/' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const serviceDef = services[data.service] || services['weddings'];
    const serviceName = serviceDef ? serviceDef.name : data.service;

    // Determine the relevant date
    const targetDate = data.service === 'sympathy' ? data.sympathyDate : data.eventDate;
    const formattedDate = targetDate
      ? new Date(targetDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : data.seasonalTiming || 'Flexible / Horizon';

    // 2. Lead Scoring Calculation (Tier A, B, C)
    const { tier, reason: leadReason } = calculateLeadTier(data.service, data.budgetBand, targetDate);

    // Resolve budget band label
    const selectedBand = serviceDef?.budgetBands.find((b) => b.id === data.budgetBand);
    const budgetLabel = selectedBand ? selectedBand.label : data.budget_fallback || 'Unspecified';

    const venue = data.venueName || (data.service === 'sympathy' ? data.funeralDirector : 'Private Location') || 'TBC';

    // Structured notification subject: [Tier] Service • Date • Venue • Budget
    const notificationSubject = `[Tier ${tier}] ${serviceName} • ${formattedDate} • ${venue} • ${budgetLabel}`;

    // 3. Resend Email Dispatch
    // Check Cloudflare locals runtime env, import.meta.env, or process.env
    const apiKey =
      (locals as any)?.runtime?.env?.RESEND_API_KEY ||
      import.meta.env.RESEND_API_KEY ||
      process.env.RESEND_API_KEY;

    const fromAddress =
      (locals as any)?.runtime?.env?.RESEND_FROM_EMAIL ||
      import.meta.env.RESEND_FROM_EMAIL ||
      process.env.RESEND_FROM_EMAIL ||
      'SB Floristry Studio <studio@mail.sbfloristry.co.uk>';

    const targetRecipient =
      (locals as any)?.runtime?.env?.RESEND_TO_EMAIL ||
      import.meta.env.RESEND_TO_EMAIL ||
      process.env.RESEND_TO_EMAIL ||
      'studio@sbfloristry.co.uk';

    // Build Internal Studio Notification HTML
    const internalEmailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #FAF8F5; line-height: 1.6; background-color: #080808; border: 1px solid rgba(255, 255, 255, 0.15); padding: 36px;">
        <div style="border-bottom: 2px solid #D4AF37; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: baseline;">
          <h2 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 26px; color: #FAF8F5; margin: 0; font-weight: 400;">
            SB Floristry Studio — New Client Commission
          </h2>
        </div>

        <div style="background-color: #121212; border-left: 3px solid #D4AF37; padding: 14px 18px; margin-bottom: 24px;">
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #D4AF37; font-weight: 600;">
            Lead Classification: Tier [${tier}]
          </span>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #9E988F;">${leadReason}</p>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0; color: #9E988F; width: 160px;">Occasion / Service:</td>
            <td style="padding: 8px 0; color: #FAF8F5; font-weight: 600;">${serviceName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #9E988F;">Date / Timing:</td>
            <td style="padding: 8px 0; color: #FAF8F5;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #9E988F;">Venue / Setting:</td>
            <td style="padding: 8px 0; color: #FAF8F5;">${venue}</td>
          </tr>
          ${data.guestCount ? `
          <tr>
            <td style="padding: 8px 0; color: #9E988F;">Guest Count:</td>
            <td style="padding: 8px 0; color: #FAF8F5;">${data.guestCount} guests</td>
          </tr>` : ''}
          ${data.plannerName ? `
          <tr>
            <td style="padding: 8px 0; color: #9E988F;">Planner / Coordinator:</td>
            <td style="padding: 8px 0; color: #FAF8F5;">${data.plannerName}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; color: #9E988F;">Budget Band:</td>
            <td style="padding: 8px 0; color: #D4AF37; font-weight: 600;">${budgetLabel}</td>
          </tr>
        </table>

        ${data.service === 'sympathy' ? `
        <div style="background-color: #121212; border: 1px solid rgba(212, 175, 55, 0.2); padding: 18px; margin-bottom: 24px;">
          <h4 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #D4AF37;">Sympathy Memorial Details</h4>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #FAF8F5;"><strong>Funeral Director:</strong> ${data.funeralDirector || 'Direct family liaison'}</p>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #FAF8F5;"><strong>Tribute Style:</strong> ${data.tributeStyle || 'Not specified'}</p>
          <p style="margin: 0; font-size: 13px; color: #FAF8F5;"><strong>Floral Wishes / Fragrance:</strong> ${data.memorialFloralWishes || 'None provided'}</p>
        </div>` : ''}

        ${data.moodWords && data.moodWords.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #9E988F;">Aesthetic Mood Keywords:</h4>
          <p style="margin: 0; font-size: 13px; color: #FAF8F5;">${data.moodWords.join(' • ')}</p>
        </div>` : ''}

        ${data.moodboardUrl ? `
        <div style="margin-bottom: 20px;">
          <h4 style="margin: 0 0 6px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #9E988F;">Inspiration Link:</h4>
          <a href="${data.moodboardUrl}" target="_blank" style="color: #D4AF37; font-size: 13px; word-break: break-all;">${data.moodboardUrl}</a>
        </div>` : ''}

        <div style="background-color: #121212; border: 1px solid rgba(255, 255, 255, 0.1); padding: 20px; margin: 24px 0;">
          <h4 style="margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #9E988F;">Client Message & Vision:</h4>
          <p style="margin: 0; font-size: 14px; white-space: pre-line; color: #FAF8F5;">${data.message}</p>
        </div>

        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 20px; margin-top: 24px;">
          <h4 style="margin: 0 0 12px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: #D4AF37;">Client Coordinates</h4>
          <p style="margin: 0 0 6px 0; font-size: 14px; color: #FAF8F5;"><strong>Name:</strong> ${data.name}</p>
          <p style="margin: 0 0 6px 0; font-size: 14px; color: #FAF8F5;"><strong>Email:</strong> <a href="mailto:${data.email}" style="color: #D4AF37; text-decoration: none;">${data.email}</a></p>
          <p style="margin: 0 0 6px 0; font-size: 14px; color: #FAF8F5;"><strong>Telephone:</strong> <a href="tel:${data.phone}" style="color: #FAF8F5; text-decoration: none;">${data.phone}</a></p>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #9E988F;"><strong>Preferred Time:</strong> ${data.contactTime}</p>
          ${data.referralSource ? `<p style="margin: 0; font-size: 13px; color: #9E988F;"><strong>Referral Source:</strong> ${data.referralSource}</p>` : ''}
        </div>

        <div style="margin-top: 32px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 16px; font-size: 11px; color: #6B665F; text-align: center;">
          SB Floristry Studio Concierge • Reply directly to this email to contact ${data.name}.
        </div>
      </div>
    `;

    // Build Editorial Client Auto-Reply HTML
    const clientAutoReplyHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #FAF8F5; line-height: 1.7; background-color: #080808; border: 1px solid rgba(212, 175, 55, 0.25); padding: 40px 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 28px; color: #FAF8F5; font-weight: 400; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 8px 0;">
            SB Floristry
          </h1>
          <p style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.25em; color: #D4AF37; margin: 0;">
            Atelier of Bespoke Floristry • London & Essex
          </p>
        </div>

        <p style="font-size: 15px; color: #FAF8F5;">Dear ${data.name},</p>

        <p style="font-size: 14px; color: #9E988F;">
          Thank you for inviting our studio to consider your ${serviceName.toLowerCase()}. We have received your commission brief and are already reviewing your date, venue, and vision.
        </p>

        <div style="background-color: #121212; border-left: 2px solid #D4AF37; padding: 18px; margin: 24px 0;">
          <p style="margin: 0; font-size: 13px; color: #FAF8F5; font-style: italic;">
            "Each season we accept a curated number of commissions so that our founders remain personally involved in every installation."
          </p>
        </div>

        <h3 style="font-family: 'Cormorant Garamond', Georgia, serif; font-size: 20px; color: #D4AF37; font-weight: 400; margin: 24px 0 10px 0;">
          Our Consultation Process
        </h3>
        <ol style="font-size: 13px; color: #9E988F; padding-left: 20px; margin: 0 0 24px 0;">
          <li style="margin-bottom: 8px;"><strong style="color: #FAF8F5;">Studio Review:</strong> Both founders review your calendar date and architectural setting within <strong>48 hours</strong>.</li>
          <li style="margin-bottom: 8px;"><strong style="color: #FAF8F5;">Private Consultation:</strong> We will reach out via telephone or email during your preferred window (${data.contactTime}) to discuss spatial scale and moodboards.</li>
          <li><strong style="color: #FAF8F5;">Botanical Proposal:</strong> An itemised spatial concept, seasonal stem selection, and investment plan will be created specifically for you.</li>
        </ol>

        <p style="font-size: 13px; color: #9E988F;">
          While we prepare your response, you are warmly invited to explore our current installation archive:
        </p>
        <p style="margin: 16px 0 32px 0;">
          <a href="https://www.sbfloristry.co.uk/portfolio/" style="display: inline-block; padding: 10px 24px; background-color: #D4AF37; color: #080808; text-decoration: none; font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600;">
            Explore Selected Works →
          </a>
        </p>

        <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 24px; margin-top: 32px; font-size: 12px; color: #9E988F;">
          <p style="margin: 0 0 4px 0; color: #FAF8F5; font-weight: 500;">Warmest regards,</p>
          <p style="margin: 0 0 16px 0; color: #D4AF37; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 18px; font-style: italic;">The Studio Founders</p>
          <p style="margin: 0; color: #6B665F; font-size: 11px;">
            SB Floristry Studio Ltd • Romford & Brentwood, Essex • By Appointment Only<br />
            Telephone: +44 (0) 1708 956609 • <a href="mailto:studio@sbfloristry.co.uk" style="color: #9E988F;">studio@sbfloristry.co.uk</a>
          </p>
        </div>
      </div>
    `;

    // 4. Resend Execution with Fallback for local development
    if (!apiKey) {
      console.warn('----------------------------------------------------');
      console.warn('⚠️ RESEND_API_KEY is not defined in environment.');
      console.warn(`Simulating lead dispatch [Tier ${tier}] locally:`);
      console.warn(`Subject: ${notificationSubject}`);
      console.warn(`Recipient: ${targetRecipient}`);
      console.warn(`Client: ${data.name} <${data.email}>, Tel: ${data.phone}`);
      console.warn('----------------------------------------------------');

      return new Response(
        JSON.stringify({
          success: true,
          mock: true,
          tier,
          redirectUrl: '/enquire/received/'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(apiKey);

    // Send studio alert
    const { data: studioMail, error: studioError } = await resend.emails.send({
      from: fromAddress,
      to: [targetRecipient],
      replyTo: `${data.name} <${data.email}>`,
      subject: notificationSubject,
      html: internalEmailHtml
    });

    if (studioError) {
      console.error('Studio alert dispatch failed:', studioError);
      return new Response(
        JSON.stringify({ success: false, error: studioError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send client auto-reply
    try {
      await resend.emails.send({
        from: fromAddress,
        to: [data.email],
        replyTo: targetRecipient,
        subject: `Your Commission Enquiry • SB Floristry`,
        html: clientAutoReplyHtml
      });
    } catch (autoErr) {
      // Don't fail the submission if client confirmation bounces
      console.error('Client auto-reply delivery notice:', autoErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        id: studioMail?.id,
        tier,
        redirectUrl: '/enquire/received/'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('API /api/enquire unexpected error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

