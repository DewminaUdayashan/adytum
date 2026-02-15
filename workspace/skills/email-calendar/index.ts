/**
 * @file workspace/skills/email-calendar/index.ts
 * @description Unified Gmail + Google Calendar skill with cross-domain planning helpers.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const PROVIDERS = ['google'] as const;
const EMAIL_MESSAGE_FORMATS = ['metadata', 'full'] as const;
const CALENDAR_ORDER_BY = ['startTime', 'updated'] as const;
const SEND_UPDATES = ['all', 'externalOnly', 'none'] as const;
const DEFAULT_MEETING_KEYWORDS = [
  'meeting',
  'call',
  'sync',
  'availability',
  'calendar',
  'invite',
  'schedule',
  'zoom',
  'teams',
  'google meet',
];
const GMAIL_METADATA_HEADERS = ['From', 'To', 'Cc', 'Bcc', 'Subject', 'Date', 'Message-ID'];

const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  provider: z.enum(PROVIDERS).default('google'),
  accessToken: z.string().optional(),
  accessTokenEnv: z.string().default('ADYTUM_EMAIL_CALENDAR_ACCESS_TOKEN'),
  refreshToken: z.string().optional(),
  refreshTokenEnv: z.string().default('ADYTUM_EMAIL_CALENDAR_REFRESH_TOKEN'),
  clientId: z.string().optional(),
  clientIdEnv: z.string().default('ADYTUM_EMAIL_CALENDAR_CLIENT_ID'),
  clientSecret: z.string().optional(),
  clientSecretEnv: z.string().default('ADYTUM_EMAIL_CALENDAR_CLIENT_SECRET'),
  tokenUrl: z.string().default('https://oauth2.googleapis.com/token'),
  gmailBaseUrl: z.string().default('https://gmail.googleapis.com/gmail/v1'),
  calendarBaseUrl: z.string().default('https://www.googleapis.com/calendar/v3'),
  defaultCalendarId: z.string().default('primary'),
  defaultTimezone: z.string().default('UTC'),
  defaultUnreadQuery: z.string().default('in:inbox is:unread newer_than:7d'),
  allowWriteActions: z.boolean().default(false),
  autoRefreshToken: z.boolean().default(true),
  requestTimeoutMs: z.number().int().min(1000).max(60000).default(12000),
});

type PluginConfig = z.infer<typeof PluginConfigSchema>;

const ListMessagesSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Gmail query syntax, e.g. "in:inbox is:unread newer_than:3d"'),
  maxResults: z.number().int().min(1).max(50).default(10).describe('Number of messages to return.'),
  labelIds: z.array(z.string().min(1)).optional().describe('Optional Gmail label IDs filter.'),
  includeHeaders: z
    .boolean()
    .default(true)
    .describe('Include common email headers in the response.'),
  includeBodyPreview: z.boolean().default(true).describe('Include Gmail snippet preview text.'),
});

const GetMessageSchema = z.object({
  messageId: z.string().min(1).describe('Gmail message ID.'),
  format: z
    .enum(EMAIL_MESSAGE_FORMATS)
    .default('metadata')
    .describe('Use metadata for lightweight reads; full to include decoded bodies when available.'),
});

const SendMessageSchema = z.object({
  to: z.array(z.string().min(3)).min(1).describe('Recipient addresses.'),
  cc: z.array(z.string().min(3)).optional().describe('Optional CC recipients.'),
  bcc: z.array(z.string().min(3)).optional().describe('Optional BCC recipients.'),
  subject: z.string().min(1).describe('Email subject.'),
  bodyText: z.string().optional().describe('Plain text body.'),
  bodyHtml: z.string().optional().describe('Optional HTML body.'),
  threadId: z
    .string()
    .optional()
    .describe('Optional Gmail thread ID to keep conversation context.'),
  inReplyToMessageId: z.string().optional().describe('RFC Message-ID value for replies.'),
  confirm: z.boolean().default(false).describe('Set true to actually send (safety guard).'),
});

const ListEventsSchema = z.object({
  calendarId: z
    .string()
    .optional()
    .describe('Calendar ID. Defaults to configured calendar or "primary".'),
  timeMinIso: z.string().optional().describe('Window start in ISO-8601 format.'),
  timeMaxIso: z.string().optional().describe('Window end in ISO-8601 format.'),
  maxResults: z.number().int().min(1).max(100).default(20).describe('Maximum events to return.'),
  query: z.string().optional().describe('Free text search over event fields.'),
  singleEvents: z.boolean().default(true).describe('Expand recurring events into instances.'),
  orderBy: z.enum(CALENDAR_ORDER_BY).default('startTime').describe('Sort order for results.'),
});

const CreateEventSchema = z.object({
  calendarId: z
    .string()
    .optional()
    .describe('Calendar ID. Defaults to configured calendar or "primary".'),
  summary: z.string().min(1).describe('Event title.'),
  description: z.string().optional().describe('Event description/agenda.'),
  location: z.string().optional().describe('Event location or virtual link context.'),
  startIso: z.string().min(1).describe('Event start time in ISO-8601 format.'),
  endIso: z.string().min(1).describe('Event end time in ISO-8601 format.'),
  timezone: z.string().optional().describe('IANA timezone (e.g. "America/New_York").'),
  attendees: z.array(z.string().min(3)).optional().describe('Optional attendee emails.'),
  createMeetLink: z.boolean().default(false).describe('Create a Google Meet link.'),
  colorId: z.string().optional().describe('Optional Google Calendar color ID (1..11).'),
  sendUpdates: z
    .enum(SEND_UPDATES)
    .default('none')
    .describe('Google Calendar attendee notification mode.'),
  confirm: z
    .boolean()
    .default(false)
    .describe('Set true to actually create the event (safety guard).'),
});

const DailyBriefingSchema = z.object({
  emailQuery: z.string().optional().describe('Gmail query for inbox briefing.'),
  emailLimit: z.number().int().min(1).max(25).default(10).describe('How many messages to scan.'),
  calendarId: z.string().optional().describe('Calendar ID for schedule scan.'),
  windowStartIso: z.string().optional().describe('Calendar window start (ISO-8601).'),
  windowEndIso: z.string().optional().describe('Calendar window end (ISO-8601).'),
  eventLimit: z.number().int().min(1).max(25).default(10).describe('How many events to include.'),
  meetingKeywords: z
    .array(z.string().min(1))
    .optional()
    .describe('Keywords used to detect inbox messages that likely need meetings.'),
});

const CreateMeetingFromMessageSchema = z.object({
  messageId: z.string().min(1).describe('Source Gmail message ID.'),
  calendarId: z.string().optional().describe('Target calendar ID.'),
  summary: z.string().optional().describe('Event summary. Defaults to source subject.'),
  descriptionPrefix: z
    .string()
    .optional()
    .describe('Optional text prepended before auto-generated source email context.'),
  location: z.string().optional().describe('Optional event location.'),
  startIso: z.string().min(1).describe('Event start time in ISO-8601 format.'),
  endIso: z.string().min(1).describe('Event end time in ISO-8601 format.'),
  timezone: z.string().optional().describe('IANA timezone (e.g. "America/New_York").'),
  attendees: z
    .array(z.string().min(3))
    .optional()
    .describe('Optional attendee emails. If omitted, sender email is used when available.'),
  createMeetLink: z.boolean().default(true).describe('Create a Google Meet link.'),
  colorId: z.string().optional().describe('Optional Google Calendar color ID (1..11).'),
  sendUpdates: z
    .enum(SEND_UPDATES)
    .default('none')
    .describe('Google Calendar attendee notification mode.'),
  confirm: z.boolean().default(false).describe('Set true to create the event (safety guard).'),
});

type MessageSummary = {
  id: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  receivedAtIso: string | null;
  snippet: string | null;
  labelIds: string[];
};

type CalendarEventSummary = {
  id: string;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  attendees: string[];
  htmlLink: string | null;
  meetLink: string | null;
};

type TokenState = {
  accessToken: string;
  expiresAt: number | null;
};

type SkillLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type ToolRegistration = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (args: unknown) => unknown;
};

type PluginApi = {
  pluginConfig?: unknown;
  logger: SkillLogger;
  registerTool: (tool: ToolRegistration) => void;
};

/**
 * Google Workspace API wrapper with token management and high-level operations.
 */
class GoogleWorkspaceGateway {
  private tokenState: TokenState | null = null;

  constructor(
    private config: PluginConfig,
    private logger: SkillLogger,
  ) {}

  async listMessages(args: z.infer<typeof ListMessagesSchema>) {
    const query = (args.query || this.config.defaultUnreadQuery || '').trim();
    const params = new URLSearchParams();
    params.set('maxResults', String(args.maxResults));
    if (query) params.set('q', query);
    for (const labelId of args.labelIds || []) {
      params.append('labelIds', labelId);
    }

    const list = await this.gmailRequest(
      `/users/me/messages${params.toString() ? `?${params.toString()}` : ''}`,
      'GET',
    );
    const rawMessages = asArray(list?.messages);
    if (rawMessages.length === 0) {
      return {
        provider: 'google',
        query,
        maxResults: args.maxResults,
        total: 0,
        messages: [] as MessageSummary[],
      };
    }

    const messages = await Promise.all(
      rawMessages.map(async (entry: unknown) => {
        const messageId = toNullableString(getProp(entry, 'id')) || '';
        if (!messageId) return null;
        return this.getMessageSummary(messageId, args.includeHeaders, args.includeBodyPreview);
      }),
    );

    const filtered = messages.filter((entry): entry is MessageSummary => Boolean(entry));
    return {
      provider: 'google',
      query,
      maxResults: args.maxResults,
      total: filtered.length,
      messages: filtered,
    };
  }

  async getMessage(args: z.infer<typeof GetMessageSchema>) {
    const params = new URLSearchParams();
    params.set('format', args.format);
    for (const headerName of GMAIL_METADATA_HEADERS) {
      params.append('metadataHeaders', headerName);
    }
    const data = await this.gmailRequest(
      `/users/me/messages/${encodeURIComponent(args.messageId)}?${params.toString()}`,
      'GET',
    );

    const headers = asArray(data?.payload?.headers);
    const textBody =
      args.format === 'full' ? extractBodyByMimeType(data?.payload, 'text/plain') : null;
    const htmlBody =
      args.format === 'full' ? extractBodyByMimeType(data?.payload, 'text/html') : null;

    return {
      provider: 'google',
      message: {
        id: String(data?.id || args.messageId),
        threadId: toNullableString(data?.threadId),
        historyId: toNullableString(data?.historyId),
        internalDate: toNullableString(data?.internalDate),
        subject: getHeaderValue(headers, 'Subject'),
        from: getHeaderValue(headers, 'From'),
        to: getHeaderValue(headers, 'To'),
        cc: getHeaderValue(headers, 'Cc'),
        bcc: getHeaderValue(headers, 'Bcc'),
        date: getHeaderValue(headers, 'Date'),
        messageId: getHeaderValue(headers, 'Message-ID'),
        labelIds: asArray(data?.labelIds).map((value) => String(value)),
        snippet: toNullableString(data?.snippet),
        textBody,
        htmlBody,
        payload: args.format === 'full' ? data?.payload || null : null,
      },
    };
  }

  async sendMessage(args: z.infer<typeof SendMessageSchema>) {
    this.assertWritesEnabled('email sends');

    if (!args.confirm) {
      return {
        status: 'requires_confirmation',
        guidance: 'Re-run with confirm=true to send this email.',
        preview: {
          to: normalizeAddressList(args.to),
          cc: normalizeAddressList(args.cc),
          bcc: normalizeAddressList(args.bcc),
          subject: args.subject.trim(),
          hasTextBody: Boolean(args.bodyText?.trim()),
          hasHtmlBody: Boolean(args.bodyHtml?.trim()),
          threadId: toNullableString(args.threadId),
        },
      };
    }

    const raw = buildRawEmail(args);
    const payload: Record<string, unknown> = {
      raw: encodeBase64Url(raw),
    };
    if (args.threadId?.trim()) {
      payload.threadId = args.threadId.trim();
    }

    const response = await this.gmailRequest('/users/me/messages/send', 'POST', payload);
    return {
      provider: 'google',
      status: 'sent',
      messageId: toNullableString(response?.id),
      threadId: toNullableString(response?.threadId),
      to: normalizeAddressList(args.to),
      subject: args.subject.trim(),
    };
  }

  async listEvents(args: z.infer<typeof ListEventsSchema>) {
    const calendarId = resolveCalendarId(args.calendarId, this.config.defaultCalendarId);
    const timeMinIso = args.timeMinIso || new Date().toISOString();
    const timeMaxIso =
      args.timeMaxIso || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams();
    params.set('timeMin', timeMinIso);
    params.set('timeMax', timeMaxIso);
    params.set('singleEvents', String(args.singleEvents));
    params.set('maxResults', String(args.maxResults));
    params.set('orderBy', args.orderBy);
    if (args.query?.trim()) params.set('q', args.query.trim());

    const data = await this.calendarRequest(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      'GET',
    );
    const events = asArray(getProp(data, 'items')).map((entry) => toEventSummary(entry));

    return {
      provider: 'google',
      calendarId,
      window: { start: timeMinIso, end: timeMaxIso },
      total: events.length,
      events,
    };
  }

  async createEvent(args: z.infer<typeof CreateEventSchema>) {
    this.assertWritesEnabled('calendar writes');

    if (!args.confirm) {
      return {
        status: 'requires_confirmation',
        guidance: 'Re-run with confirm=true to create this event.',
        preview: {
          calendarId: resolveCalendarId(args.calendarId, this.config.defaultCalendarId),
          summary: args.summary.trim(),
          startIso: args.startIso,
          endIso: args.endIso,
          timezone: args.timezone || this.config.defaultTimezone,
          attendees: normalizeAddressList(args.attendees),
          createMeetLink: args.createMeetLink,
          sendUpdates: args.sendUpdates,
        },
      };
    }

    return this.createEventInternal({
      calendarId: args.calendarId,
      summary: args.summary,
      description: args.description,
      location: args.location,
      startIso: args.startIso,
      endIso: args.endIso,
      timezone: args.timezone,
      attendees: args.attendees,
      createMeetLink: args.createMeetLink,
      colorId: args.colorId,
      sendUpdates: args.sendUpdates,
    });
  }

  async dailyBriefing(args: z.infer<typeof DailyBriefingSchema>) {
    const calendarId = resolveCalendarId(args.calendarId, this.config.defaultCalendarId);
    const windowStartIso = args.windowStartIso || new Date().toISOString();
    const windowEndIso =
      args.windowEndIso || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const keywords = normalizeKeywords(args.meetingKeywords);

    const [emails, events] = await Promise.all([
      this.listMessages({
        query: args.emailQuery || this.config.defaultUnreadQuery,
        maxResults: args.emailLimit,
        includeHeaders: true,
        includeBodyPreview: true,
        labelIds: undefined,
      }),
      this.listEvents({
        calendarId,
        timeMinIso: windowStartIso,
        timeMaxIso: windowEndIso,
        maxResults: args.eventLimit,
        query: undefined,
        singleEvents: true,
        orderBy: 'startTime',
      }),
    ]);

    const meetingCandidates = emails.messages
      .filter((message) => hasMeetingSignal(message, keywords))
      .map((message) => ({
        messageId: message.id,
        subject: message.subject,
        from: message.from,
        snippet: message.snippet,
      }));

    const nextActions = buildNextActions(meetingCandidates.length, events.events.length);

    return {
      provider: 'google',
      generatedAtIso: new Date().toISOString(),
      inbox: {
        query: emails.query,
        total: emails.total,
        messages: emails.messages,
      },
      calendar: {
        calendarId,
        window: events.window,
        total: events.total,
        events: events.events,
      },
      signals: {
        meetingKeywords: keywords,
        meetingCandidateCount: meetingCandidates.length,
        meetingCandidates,
        nextActions,
      },
    };
  }

  async createMeetingFromMessage(args: z.infer<typeof CreateMeetingFromMessageSchema>) {
    this.assertWritesEnabled('calendar writes from email context');

    const source = await this.getMessage({
      messageId: args.messageId,
      format: 'metadata',
    });

    const sourceSubject = source.message.subject || 'Follow-up meeting';
    const sourceFrom = source.message.from || '';
    const sourceSenderEmail = extractEmailAddress(sourceFrom);
    const requestedAttendees = normalizeAddressList(args.attendees);
    const attendees = requestedAttendees.length
      ? requestedAttendees
      : sourceSenderEmail
        ? [sourceSenderEmail]
        : [];

    const descriptionParts = [
      args.descriptionPrefix?.trim(),
      `Source email subject: ${sourceSubject}`,
      `Source email from: ${sourceFrom || 'Unknown sender'}`,
      source.message.snippet ? `Source snippet: ${source.message.snippet}` : null,
      `Source message ID: ${source.message.id}`,
    ].filter((entry): entry is string => Boolean(entry && entry.trim()));

    if (!args.confirm) {
      return {
        status: 'requires_confirmation',
        guidance: 'Re-run with confirm=true to create this event from the email.',
        preview: {
          sourceMessageId: args.messageId,
          summary: (args.summary || sourceSubject).trim(),
          startIso: args.startIso,
          endIso: args.endIso,
          timezone: args.timezone || this.config.defaultTimezone,
          attendees,
          createMeetLink: args.createMeetLink,
          sendUpdates: args.sendUpdates,
        },
      };
    }

    const eventResult = await this.createEventInternal({
      calendarId: args.calendarId,
      summary: args.summary || sourceSubject,
      description: descriptionParts.join('\n\n'),
      location: args.location,
      startIso: args.startIso,
      endIso: args.endIso,
      timezone: args.timezone,
      attendees,
      createMeetLink: args.createMeetLink,
      colorId: args.colorId,
      sendUpdates: args.sendUpdates,
    });

    return {
      provider: 'google',
      sourceMessage: {
        id: source.message.id,
        subject: source.message.subject,
        from: source.message.from,
      },
      createdEvent: eventResult.event,
      calendarId: eventResult.calendarId,
    };
  }

  private async createEventInternal(args: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    startIso: string;
    endIso: string;
    timezone?: string;
    attendees?: string[];
    createMeetLink: boolean;
    colorId?: string;
    sendUpdates: z.infer<typeof CreateEventSchema>['sendUpdates'];
  }) {
    const calendarId = resolveCalendarId(args.calendarId, this.config.defaultCalendarId);
    const timezone = (args.timezone || this.config.defaultTimezone || 'UTC').trim();
    const params = new URLSearchParams();
    if (args.sendUpdates !== 'none') params.set('sendUpdates', args.sendUpdates);
    if (args.createMeetLink) params.set('conferenceDataVersion', '1');
    const suffix = params.toString() ? `?${params.toString()}` : '';

    const payload: Record<string, unknown> = {
      summary: args.summary.trim(),
      description: args.description?.trim() || undefined,
      location: args.location?.trim() || undefined,
      start: {
        dateTime: args.startIso,
        timeZone: timezone,
      },
      end: {
        dateTime: args.endIso,
        timeZone: timezone,
      },
    };

    const attendees = normalizeAddressList(args.attendees).map((email) => ({ email }));
    if (attendees.length > 0) payload.attendees = attendees;
    if (args.colorId?.trim()) payload.colorId = args.colorId.trim();
    if (args.createMeetLink) {
      payload.conferenceData = {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      };
    }

    const event = await this.calendarRequest(
      `/calendars/${encodeURIComponent(calendarId)}/events${suffix}`,
      'POST',
      payload,
    );
    return {
      provider: 'google',
      status: 'created',
      calendarId,
      event: toEventSummary(event),
    };
  }

  private async getMessageSummary(
    messageId: string,
    includeHeaders: boolean,
    includeBodyPreview: boolean,
  ): Promise<MessageSummary | null> {
    const params = new URLSearchParams();
    params.set('format', 'metadata');
    for (const headerName of GMAIL_METADATA_HEADERS) {
      params.append('metadataHeaders', headerName);
    }
    const data = await this.gmailRequest(
      `/users/me/messages/${encodeURIComponent(messageId)}?${params.toString()}`,
      'GET',
    );
    const headers = asArray(data?.payload?.headers);

    return {
      id: String(data?.id || messageId),
      threadId: toNullableString(data?.threadId),
      subject: includeHeaders ? getHeaderValue(headers, 'Subject') : null,
      from: includeHeaders ? getHeaderValue(headers, 'From') : null,
      to: includeHeaders ? getHeaderValue(headers, 'To') : null,
      date: includeHeaders ? getHeaderValue(headers, 'Date') : null,
      receivedAtIso: toIsoDateString(data?.internalDate),
      snippet: includeBodyPreview ? toNullableString(data?.snippet) : null,
      labelIds: asArray(data?.labelIds).map((value) => String(value)),
    };
  }

  private async gmailRequest(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    return this.googleRequest(
      `${stripTrailingSlash(this.config.gmailBaseUrl)}${path}`,
      method,
      body,
      'Gmail',
    );
  }

  private async calendarRequest(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    return this.googleRequest(
      `${stripTrailingSlash(this.config.calendarBaseUrl)}${path}`,
      method,
      body,
      'Google Calendar',
    );
  }

  private async googleRequest(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    service: string,
  ): Promise<Record<string, unknown>> {
    const token = await this.ensureAccessToken(false);
    let response = await this.fetchJson(url, {
      method,
      token,
      jsonBody: body,
      contentType: 'application/json',
    });

    if (
      response.status === 401 &&
      this.config.autoRefreshToken &&
      this.hasRefreshCredentials() &&
      !response.ok
    ) {
      this.logger.warn(`${service}: token rejected; attempting refresh and retry.`);
      const refreshedToken = await this.ensureAccessToken(true);
      response = await this.fetchJson(url, {
        method,
        token: refreshedToken,
        jsonBody: body,
        contentType: 'application/json',
      });
    }

    const parsed = unwrapApiResponse(response, service);
    return asRecord(parsed) || {};
  }

  private async ensureAccessToken(forceRefresh: boolean): Promise<string> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.tokenState &&
      (!this.tokenState.expiresAt || this.tokenState.expiresAt - 30_000 > now)
    ) {
      return this.tokenState.accessToken;
    }

    if (!forceRefresh && this.config.accessToken?.trim()) {
      this.tokenState = {
        accessToken: this.config.accessToken.trim(),
        expiresAt: null,
      };
      return this.tokenState.accessToken;
    }

    if (this.config.autoRefreshToken && this.hasRefreshCredentials()) {
      const refreshed = await this.refreshAccessToken();
      this.tokenState = refreshed;
      return refreshed.accessToken;
    }

    if (this.config.accessToken?.trim()) {
      return this.config.accessToken.trim();
    }

    throw new Error(
      `Missing OAuth credentials. Provide ${this.config.accessTokenEnv} or configure refresh token credentials.`,
    );
  }

  private hasRefreshCredentials(): boolean {
    return Boolean(
      this.config.refreshToken?.trim() &&
      this.config.clientId?.trim() &&
      this.config.clientSecret?.trim(),
    );
  }

  private async refreshAccessToken(): Promise<TokenState> {
    if (!this.hasRefreshCredentials()) {
      throw new Error('Refresh token flow is not configured.');
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', this.config.refreshToken!.trim());
    form.set('client_id', this.config.clientId!.trim());
    form.set('client_secret', this.config.clientSecret!.trim());

    const response = await this.fetchJson(this.config.tokenUrl, {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      rawBody: form.toString(),
      token: null,
    });
    const data = unwrapApiResponse(response, 'OAuth');
    const accessToken = String(data?.access_token || '').trim();
    if (!accessToken) {
      throw new Error('OAuth refresh response did not include access_token.');
    }

    const expiresIn = Number(data?.expires_in || 0);
    const expiresAt =
      Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;
    return { accessToken, expiresAt };
  }

  private assertWritesEnabled(operation: string) {
    if (this.config.allowWriteActions) return;
    throw new Error(
      `Write actions are disabled for ${operation}. Set skills.entries.email-calendar.config.allowWriteActions=true.`,
    );
  }

  private async fetchJson(
    url: string,
    options: {
      method: 'GET' | 'POST';
      token: string | null;
      contentType: string;
      jsonBody?: unknown;
      rawBody?: string;
    },
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (options.contentType) headers['Content-Type'] = options.contentType;
      if (options.token) headers.Authorization = `Bearer ${options.token}`;

      const response = await fetch(url, {
        method: options.method,
        headers,
        body:
          options.rawBody !== undefined
            ? options.rawBody
            : options.jsonBody !== undefined
              ? JSON.stringify(options.jsonBody)
              : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        data,
      };
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new Error(`Request timed out after ${this.config.requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const emailCalendarPlugin = {
  id: 'email-calendar',
  name: 'Email + Calendar',
  description: 'Unified Gmail and Google Calendar operations with cross-domain planning tools.',

  register(api: PluginApi) {
    const config = resolveConfig(api.pluginConfig);
    const logger = api.logger as SkillLogger;

    if (!config.enabled) {
      logger.info('Email + Calendar skill disabled (enabled=false).');
      return;
    }

    if (config.provider !== 'google') {
      logger.warn(
        `Unsupported provider "${config.provider}". This skill currently supports only Google.`,
      );
      return;
    }

    const gateway = new GoogleWorkspaceGateway(config, logger);

    api.registerTool({
      name: 'email_calendar_list_messages',
      description: 'List Gmail messages with optional query filters and headers.',
      parameters: ListMessagesSchema,
      execute: (args: unknown) =>
        runTool(() => gateway.listMessages(ListMessagesSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_get_message',
      description: 'Get a Gmail message by ID.',
      parameters: GetMessageSchema,
      execute: (args: unknown) => runTool(() => gateway.getMessage(GetMessageSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_send_message',
      description: 'Send Gmail messages with confirmation guard.',
      parameters: SendMessageSchema,
      execute: (args: unknown) => runTool(() => gateway.sendMessage(SendMessageSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_list_events',
      description: 'List Google Calendar events in a time window.',
      parameters: ListEventsSchema,
      execute: (args: unknown) => runTool(() => gateway.listEvents(ListEventsSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_create_event',
      description: 'Create Google Calendar events with confirmation guard.',
      parameters: CreateEventSchema,
      execute: (args: unknown) => runTool(() => gateway.createEvent(CreateEventSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_daily_briefing',
      description:
        'Generate a combined inbox and calendar briefing with meeting candidate detection.',
      parameters: DailyBriefingSchema,
      execute: (args: unknown) =>
        runTool(() => gateway.dailyBriefing(DailyBriefingSchema.parse(args))),
    });

    api.registerTool({
      name: 'email_calendar_create_meeting_from_message',
      description: 'Create a calendar event from a source email with auto-context.',
      parameters: CreateMeetingFromMessageSchema,
      execute: (args: unknown) =>
        runTool(() => gateway.createMeetingFromMessage(CreateMeetingFromMessageSchema.parse(args))),
    });
  },
};

export default emailCalendarPlugin;

async function runTool<T>(op: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await op();
  } catch (error: unknown) {
    return {
      error: errorMessage(error),
    };
  }
}

function resolveConfig(raw: unknown): PluginConfig {
  const parsed = PluginConfigSchema.safeParse(raw || {});
  const base = parsed.success ? parsed.data : PluginConfigSchema.parse({});

  return {
    ...base,
    accessToken: fromValueOrEnv(base.accessToken, base.accessTokenEnv),
    refreshToken: fromValueOrEnv(base.refreshToken, base.refreshTokenEnv),
    clientId: fromValueOrEnv(base.clientId, base.clientIdEnv),
    clientSecret: fromValueOrEnv(base.clientSecret, base.clientSecretEnv),
  };
}

function fromValueOrEnv(value: string | undefined, envName: string): string | undefined {
  const direct = value?.trim();
  if (direct) return direct;
  const envValue = process.env[envName];
  return envValue?.trim() || undefined;
}

function unwrapApiResponse(
  response: { ok: boolean; status: number; statusText: string; data: unknown },
  service: string,
) {
  if (response.ok) return response.data;
  const detail = extractApiErrorMessage(response.data);
  const suffix = detail ? `: ${detail}` : '';
  throw new Error(`${service} API ${response.status} ${response.statusText}${suffix}`.trim());
}

function extractApiErrorMessage(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const root = asRecord(data);
  const errorBlock = asRecord(root?.error);
  const errorMessageFromBlock = toNullableString(errorBlock?.message);
  if (errorMessageFromBlock) return errorMessageFromBlock;
  const directMessage = toNullableString(root?.message);
  if (directMessage) return directMessage;
  return '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNullableString(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function toIsoDateString(epochMsString: unknown): string | null {
  const raw = typeof epochMsString === 'string' ? Number(epochMsString) : Number(epochMsString);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return new Date(raw).toISOString();
}

function getHeaderValue(headers: unknown[], targetName: string): string | null {
  const match = headers.find((header) => {
    const name = toNullableString(getProp(header, 'name'))?.toLowerCase() || '';
    return name === targetName.toLowerCase();
  });
  return toNullableString(getProp(match, 'value'));
}

function normalizeAddressList(values?: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values || []) {
    const cleaned = raw.trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function resolveCalendarId(calendarId: string | undefined, fallbackCalendarId: string): string {
  return (calendarId || fallbackCalendarId || 'primary').trim() || 'primary';
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}

function buildRawEmail(args: z.infer<typeof SendMessageSchema>): string {
  const to = normalizeAddressList(args.to);
  const cc = normalizeAddressList(args.cc);
  const bcc = normalizeAddressList(args.bcc);
  const subject = args.subject.trim();
  const bodyText = args.bodyText?.trim() || '';
  const bodyHtml = args.bodyHtml?.trim() || '';

  if (!bodyText && !bodyHtml) {
    throw new Error('Provide at least one of bodyText or bodyHtml.');
  }

  const headers: string[] = [
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(', ')}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  if (args.inReplyToMessageId?.trim()) {
    const ref = args.inReplyToMessageId.trim();
    headers.push(`In-Reply-To: ${ref}`, `References: ${ref}`);
  }

  if (bodyText && bodyHtml) {
    const boundary = `adytum-${randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return `${headers.join('\r\n')}\r\n\r\n${[
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      bodyText,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      bodyHtml,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n')}`;
  }

  if (bodyHtml) {
    headers.push('Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: 7bit');
    return `${headers.join('\r\n')}\r\n\r\n${bodyHtml}`;
  }

  headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 7bit');
  return `${headers.join('\r\n')}\r\n\r\n${bodyText}`;
}

function encodeBase64Url(raw: string): string {
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(raw: string): string {
  const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractBodyByMimeType(payload: unknown, targetMimeType: string): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  if (
    toNullableString(root.mimeType) === targetMimeType &&
    typeof getProp(getProp(root, 'body'), 'data') === 'string'
  ) {
    return decodeBase64Url(String(getProp(getProp(root, 'body'), 'data')));
  }
  const parts = asArray(root.parts);
  if (parts.length > 0) {
    for (const part of parts) {
      const decoded = extractBodyByMimeType(part, targetMimeType);
      if (decoded) return decoded;
    }
  }
  if (
    targetMimeType === 'text/plain' &&
    toNullableString(root.mimeType) === 'text/plain' &&
    typeof getProp(getProp(root, 'body'), 'data') === 'string'
  ) {
    return decodeBase64Url(String(getProp(getProp(root, 'body'), 'data')));
  }
  return null;
}

function toEventSummary(event: unknown): CalendarEventSummary {
  return {
    id: String(getProp(event, 'id') || ''),
    status: toNullableString(getProp(event, 'status')),
    summary: toNullableString(getProp(event, 'summary')),
    description: toNullableString(getProp(event, 'description')),
    location: toNullableString(getProp(event, 'location')),
    start: normalizeEventTime(getProp(event, 'start')),
    end: normalizeEventTime(getProp(event, 'end')),
    attendees: asArray(getProp(event, 'attendees'))
      .map((attendee) => toNullableString(getProp(attendee, 'email')))
      .filter((value): value is string => Boolean(value)),
    htmlLink: toNullableString(getProp(event, 'htmlLink')),
    meetLink: toNullableString(getProp(event, 'hangoutLink')),
  };
}

function normalizeEventTime(value: unknown): string | null {
  const root = asRecord(value);
  if (!root) return null;
  const dateTime = toNullableString(root.dateTime);
  if (dateTime) return dateTime;
  const date = toNullableString(root.date);
  if (date) return date;
  return null;
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  const base = keywords && keywords.length > 0 ? keywords : DEFAULT_MEETING_KEYWORDS;
  return base.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
}

function hasMeetingSignal(message: MessageSummary, keywords: string[]): boolean {
  const text = `${message.subject || ''} ${message.snippet || ''}`.toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function buildNextActions(meetingCandidateCount: number, eventCount: number): string[] {
  const actions: string[] = [];
  if (meetingCandidateCount > 0) {
    actions.push(
      `Review ${meetingCandidateCount} inbox message(s) that look meeting-related and convert them into events if needed.`,
    );
  }
  if (eventCount === 0) {
    actions.push(
      'No upcoming events found in the selected window; verify calendar filters or create new events.',
    );
  }
  if (actions.length === 0) {
    actions.push('Inbox and calendar look aligned; continue normal execution.');
  }
  return actions;
}

function extractEmailAddress(input: string): string | null {
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getProp(value: unknown, key: string): unknown {
  const root = asRecord(value);
  if (!root) return undefined;
  return root[key];
}

function isAbortError(error: unknown): boolean {
  const root = asRecord(error);
  return toNullableString(root?.name) === 'AbortError';
}

function errorMessage(error: unknown): string {
  const root = asRecord(error);
  return toNullableString(root?.message) || 'Skill operation failed.';
}
