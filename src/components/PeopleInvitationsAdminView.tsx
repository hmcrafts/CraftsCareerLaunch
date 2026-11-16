import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
  Loader2,
  MailWarning,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  ManualInviteLinkResponse,
  createJobSeekerInvitation,
  fetchAdminInvitations,
  generateManualInviteLink,
  resendJobSeekerInvitation,
  revokeJobSeekerInvitation,
} from "../services/apiClient";
import {
  AuditLogEntry,
  InvitationRecord,
  InvitationStatus,
} from "../types/models";

interface PeopleInvitationsAdminViewProps {
  adminDisplayName: string;
  adminUid: string;
}

const STATUS_LABELS: Record<InvitationStatus, string> = {
  pending_delivery: "Pending delivery",
  sent: "Sent",
  delivery_failed: "Delivery failed",
  expired: "Expired",
  revoked: "Revoked",
  accepted: "Accepted",
};

const STATUS_FILTER_OPTIONS: Array<{ value: "all" | InvitationStatus; label: string }> =
  [
    { value: "all", label: "All" },
    { value: "pending_delivery", label: "Pending delivery" },
    { value: "sent", label: "Sent" },
    { value: "delivery_failed", label: "Delivery failed" },
    { value: "expired", label: "Expired" },
    { value: "revoked", label: "Revoked" },
    { value: "accepted", label: "Accepted" },
  ];

const STRICT_CLIENT_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function formatShortDateTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPreviewEmailText(params: {
  inviterName: string;
  personalMessage: string;
  expiresAtIso: string;
  appOrigin: string;
}): { subject: string; body: string } {
  const expFormatted = new Date(params.expiresAtIso).toUTCString();
  const lines: string[] = [
    `${params.inviterName} has invited you to create a private job-search workspace in Career Launch.`,
    "",
    "You can organize opportunities, prepare applications, practice interviews, and plan your next steps.",
    "",
    "Your career information is private by default. The person who invited you does not automatically receive access.",
  ];
  if (params.personalMessage.trim()) {
    lines.push("", params.personalMessage.trim());
  }
  lines.push(
    "",
    `Accept invitation: ${params.appOrigin}/?invite=[single-use-256-bit-token]`,
    "",
    `This invitation expires on ${expFormatted}.`,
    "",
    "If you weren’t expecting this invitation, you can ignore it."
  );
  return {
    subject: "You’re invited to Career Launch",
    body: lines.join("\n"),
  };
}

function statusTextClass(status: InvitationStatus): string {
  switch (status) {
    case "accepted":
      return "text-teal-900 font-semibold";
    case "sent":
      return "text-slate-900 font-medium";
    case "pending_delivery":
      return "text-amber-900 font-medium";
    case "delivery_failed":
      return "text-red-800 font-semibold";
    case "expired":
      return "text-slate-500 font-medium";
    case "revoked":
      return "text-slate-500 line-through";
    default:
      return "text-slate-700";
  }
}

export const PeopleInvitationsAdminView: React.FC<
  PeopleInvitationsAdminViewProps
> = ({ adminDisplayName }) => {
  const [invitations, setInvitations] = useState<InvitationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [emailConfigured, setEmailConfigured] = useState<boolean>(false);
  const [emailProviderName, setEmailProviderName] = useState<string>("none");
  const [appOrigin, setAppOrigin] = useState<string>(window.location.origin);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showEmailSetupHelp, setShowEmailSetupHelp] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvitationStatus>(
    "all"
  );

  // Two-step Invite Job Seeker Modal State
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [modalStep, setModalStep] = useState<"form" | "review">("form");
  const [formDisplayName, setFormDisplayName] = useState<string>("");
  const [formEmail, setFormEmail] = useState<string>("");
  const [formMessage, setFormMessage] = useState<string>("");
  const [formExpirationDays, setFormExpirationDays] = useState<number>(7);
  const [formSuggestionsText, setFormSuggestionsText] = useState<string>("");
  const [showSuggestionsInput, setShowSuggestionsInput] =
    useState<boolean>(false);
  const [formIdempotencyKey, setFormIdempotencyKey] = useState<string>("");
  const [formFieldErrors, setFormFieldErrors] = useState<{
    displayName?: string;
    email?: string;
    personalMessage?: string;
    general?: string;
  }>({});
  const [submittingInvite, setSubmittingInvite] = useState<boolean>(false);

  // Post-action Banner & Manual Secure Link Modal
  const [feedbackBanner, setFeedbackBanner] = useState<{
    tone: "info" | "warning" | "error";
    heading: string;
    detail: string;
    invitationIdForManualLink?: string;
  } | null>(null);

  const [manualLinkResult, setManualLinkResult] =
    useState<ManualInviteLinkResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<"url" | "body" | null>(null);

  // Row Actions State
  const [selectedDetailsInvite, setSelectedDetailsInvite] =
    useState<InvitationRecord | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const [liveStatusAnnouncement, setLiveStatusAnnouncement] =
    useState<string>("");
  const primaryModalInputRef = useRef<HTMLInputElement | null>(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdminInvitations();
      setInvitations(data.invitations);
      setAuditLogs(data.auditLogs);
      setEmailConfigured(data.emailDeliveryConfigured);
      setEmailProviderName(data.emailProviderName);
      if (data.appOrigin) setAppOrigin(data.appOrigin);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "Unable to load People & Invitations."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const openInviteModal = () => {
    setFormDisplayName("");
    setFormEmail("");
    setFormMessage("");
    setFormExpirationDays(7);
    setFormSuggestionsText("");
    setShowSuggestionsInput(false);
    setFormFieldErrors({});
    setFormIdempotencyKey(
      `inv_idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    );
    setModalStep("form");
    setModalOpen(true);
    window.setTimeout(() => primaryModalInputRef.current?.focus(), 40);
  };

  const validateStepOne = (): boolean => {
    const errors: typeof formFieldErrors = {};
    const trimmedName = formDisplayName.trim();
    const trimmedEmail = formEmail.trim();

    if (!trimmedName) {
      errors.displayName = "Display name is required.";
    } else if (trimmedName.length > 120) {
      errors.displayName = "Display name must be 120 characters or fewer.";
    }

    if (!trimmedEmail) {
      errors.email = "Email address is required.";
    } else if (
      trimmedEmail.length > 254 ||
      !STRICT_CLIENT_EMAIL_REGEX.test(trimmedEmail)
    ) {
      errors.email =
        "Enter a valid email address (for example, name@domain.com).";
    }

    if (formMessage.trim().length > 500) {
      errors.personalMessage =
        "Optional personal message must be 500 characters or fewer.";
    }

    setFormFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStepOne()) return;
    setModalStep("review");
    setLiveStatusAnnouncement(
      "Reviewing invitation details before sending. Nothing has been sent yet."
    );
  };

  const previewExpiresIso = useMemo(() => {
    const ms = Date.now() + formExpirationDays * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString();
  }, [formExpirationDays, modalStep]);

  const effectiveInviterName = adminDisplayName.trim() || "Administrator";

  const emailPreview = useMemo(
    () =>
      buildPreviewEmailText({
        inviterName: effectiveInviterName,
        personalMessage: formMessage,
        expiresAtIso: previewExpiresIso,
        appOrigin,
      }),
    [effectiveInviterName, formMessage, previewExpiresIso, appOrigin]
  );

  const parsedSuggestedItems = useMemo(
    () =>
      formSuggestionsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
    [formSuggestionsText]
  );

  const handleSendInvitationConfirmed = async () => {
    if (submittingInvite) return;
    setSubmittingInvite(true);
    setFormFieldErrors({});
    setLiveStatusAnnouncement("Recording invitation...");

    try {
      const resp = await createJobSeekerInvitation({
        displayName: formDisplayName.trim(),
        email: formEmail.trim(),
        personalMessage: formMessage.trim(),
        inviterDisplayName: effectiveInviterName,
        expirationDays: formExpirationDays,
        idempotencyKey: formIdempotencyKey,
        suggestedItems: parsedSuggestedItems,
      });

      setModalOpen(false);
      await loadAdminData();

      if (resp.deliveryOutcome === "unconfigured") {
        setFeedbackBanner({
          tone: "warning",
          heading: "Email invitations are not configured.",
          detail: `Recorded invitation for ${resp.invitation.recipientDisplayName} (${resp.invitation.recipientEmail}) with status "Pending delivery". No email was sent. Configure an email provider in environment secrets, or explicitly generate a single-use secure invite link for manual delivery.`,
          invitationIdForManualLink: resp.invitation.id,
        });
        setLiveStatusAnnouncement(
          "Email invitations are not configured. Invitation saved as Pending delivery."
        );
      } else if (resp.deliveryOutcome === "delivery_failed") {
        setFeedbackBanner({
          tone: "error",
          heading: "Invitation email delivery failed.",
          detail: `${resp.providerDetailMessage} Invitation saved as "Delivery failed".`,
          invitationIdForManualLink: resp.invitation.id,
        });
        setLiveStatusAnnouncement("Invitation email delivery failed.");
      } else {
        setFeedbackBanner({
          tone: "info",
          heading: "Invitation accepted by email provider for sending.",
          detail: `${resp.providerDetailMessage} Status recorded as "Sent" (provider acceptance confirmed; final inbox delivery depends on recipient mail server).`,
        });
        setLiveStatusAnnouncement("Invitation accepted by email provider.");
      }
    } catch (err) {
      const typed = err as Error & { field?: string };
      if (typed.field === "email" || typed.field === "displayName") {
        setModalStep("form");
        setFormFieldErrors({ [typed.field]: typed.message });
      } else {
        setFormFieldErrors({
          general: typed.message || "Unable to create invitation.",
        });
      }
    } finally {
      setSubmittingInvite(false);
    }
  };

  const handleResend = async (inv: InvitationRecord) => {
    if (rowBusyId) return;
    setRowBusyId(inv.id);
    setFeedbackBanner(null);
    try {
      const resp = await resendJobSeekerInvitation(inv.id);
      await loadAdminData();
      if (resp.deliveryOutcome === "unconfigured") {
        setFeedbackBanner({
          tone: "warning",
          heading: "Email invitations are not configured.",
          detail: `Rotated single-use token and invalidated the previous link for ${inv.recipientEmail}, but no email was sent (status: "Pending delivery"). You can generate a single-use manual invite link if needed.`,
          invitationIdForManualLink: inv.id,
        });
      } else if (resp.deliveryOutcome === "delivery_failed") {
        setFeedbackBanner({
          tone: "error",
          heading: "Resend delivery failed.",
          detail: resp.providerDetailMessage,
          invitationIdForManualLink: inv.id,
        });
      } else {
        setFeedbackBanner({
          tone: "info",
          heading: "New invitation token queued with email provider.",
          detail: `Previous unredeemed link invalidated. ${resp.providerDetailMessage}`,
        });
      }
    } catch (err) {
      setFeedbackBanner({
        tone: "error",
        heading: "Could not resend invitation.",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRowBusyId(null);
    }
  };

  const handleGenerateManualLink = async (invitationId: string) => {
    if (rowBusyId) return;
    setRowBusyId(invitationId);
    try {
      const resp = await generateManualInviteLink(invitationId);
      setManualLinkResult(resp);
      setCopiedKey(null);
      await loadAdminData();
      setLiveStatusAnnouncement(
        "Generated single-use secure invitation link. Handle carefully."
      );
    } catch (err) {
      setFeedbackBanner({
        tone: "error",
        heading: "Unable to generate manual link.",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRowBusyId(null);
    }
  };

  const handleConfirmRevoke = async (invitationId: string) => {
    if (rowBusyId) return;
    setRowBusyId(invitationId);
    try {
      await revokeJobSeekerInvitation(invitationId);
      setConfirmRevokeId(null);
      if (selectedDetailsInvite?.id === invitationId) {
        setSelectedDetailsInvite(null);
      }
      await loadAdminData();
      setFeedbackBanner({
        tone: "info",
        heading: "Invitation revoked.",
        detail:
          "The unredeemed invitation token has been permanently deactivated and can no longer be accepted.",
      });
      setLiveStatusAnnouncement("Invitation revoked.");
    } catch (err) {
      setFeedbackBanner({
        tone: "error",
        heading: "Unable to revoke invitation.",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRowBusyId(null);
    }
  };

  const copyText = async (text: string, which: "url" | "body") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(which);
      window.setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const filteredInvitations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invitations.filter((inv) => {
      if (statusFilter !== "all" && inv.effectiveStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        inv.recipientDisplayName.toLowerCase().includes(q) ||
        inv.recipientEmailNormalized.includes(q)
      );
    });
  }, [invitations, searchQuery, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="sr-only" role="status" aria-live="polite">
        {liveStatusAnnouncement}
      </div>

      {/* Section 2 Exact Header, Description & Primary Button */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            People & Invitations
          </h2>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Invite someone to start a private job-search workspace. Inviting them does not give you access to their career records.
          </p>
        </div>

        <button
          type="button"
          onClick={openInviteModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Invite job seeker</span>
        </button>
      </div>

      {/* Section 14 Honest Unconfigured Email Provider Banner */}
      {!loading && !emailConfigured && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-950">
              <MailWarning className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">
                  Email invitations are not configured.
                </strong>{" "}
                Career Launch will record new invitations as{" "}
                <strong>Pending delivery</strong> and will never claim an email was sent. Configure a transactional email provider or explicitly generate a single-use secure invite link.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEmailSetupHelp((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-amber-950 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              {showEmailSetupHelp ? "Hide setup instructions" : "Setup instructions"}
            </button>
          </div>

          {showEmailSetupHelp && (
            <div className="pt-3 border-t border-amber-200 text-xs text-amber-950 space-y-1.5 leading-relaxed">
              <p className="font-semibold">
                Administrator Email Provider Configuration (AI Studio Settings → Secrets):
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <code className="font-mono">EMAIL_PROVIDER</code>: set to{" "}
                  <code className="font-mono">resend</code>,{" "}
                  <code className="font-mono">postmark</code>, or{" "}
                  <code className="font-mono">sendgrid</code>.
                </li>
                <li>
                  <code className="font-mono">EMAIL_API_KEY</code>: server-side API token for the chosen provider (never exposed to browser code).
                </li>
                <li>
                  <code className="font-mono">EMAIL_FROM</code>: verified sender address on your domain (for example,{" "}
                  <code className="font-mono">invites@yourdomain.com</code>).
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {emailConfigured && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-slate-600">
          <span>
            Outbound email provider configured:{" "}
            <strong className="text-slate-900 uppercase">
              {emailProviderName}
            </strong>{" "}
            (status “Sent” indicates provider API acceptance, not guaranteed inbox placement).
          </span>
        </div>
      )}

      {/* Post-Action Result Banner */}
      {feedbackBanner && (
        <div
          role="alert"
          className={`rounded-xl p-4 border flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
            feedbackBanner.tone === "error"
              ? "bg-red-50 border-red-300 text-red-950"
              : feedbackBanner.tone === "warning"
              ? "bg-amber-50 border-amber-300 text-amber-950"
              : "bg-teal-50/70 border-teal-200 text-teal-950"
          }`}
        >
          <div className="flex items-start gap-2.5 text-xs sm:text-sm">
            {feedbackBanner.tone === "error" ? (
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            ) : feedbackBanner.tone === "warning" ? (
              <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-teal-800 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-semibold">{feedbackBanner.heading}</p>
              <p className="leading-relaxed opacity-90">{feedbackBanner.detail}</p>
              {feedbackBanner.invitationIdForManualLink && (
                <div className="pt-1.5">
                  <button
                    type="button"
                    disabled={rowBusyId === feedbackBanner.invitationIdForManualLink}
                    onClick={() =>
                      handleGenerateManualLink(
                        feedbackBanner.invitationIdForManualLink!
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-teal-800" />
                    <span>Generate secure invite link for manual delivery</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-xs font-medium underline self-start shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Status Filters (Section 3) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by display name or email address..."
              aria-label="Search invitations"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <button
            type="button"
            onClick={loadAdminData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 self-start md:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {STATUS_FILTER_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-slate-900 text-white border-slate-900 font-semibold"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* People & Invitations Table (Section 3 — Zero Private Workspace Data) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center gap-2.5 text-sm text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin text-teal-800" />
            <span>Loading invitation records...</span>
          </div>
        ) : loadError ? (
          <div className="p-6 text-sm text-red-800 space-y-2">
            <p className="font-semibold">{loadError}</p>
            <button
              type="button"
              onClick={loadAdminData}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-800 rounded-lg"
            >
              Retry
            </button>
          </div>
        ) : filteredInvitations.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">
              {invitations.length === 0
                ? "No job-seeker invitations created yet."
                : "No invitations match your current search or status filter."}
            </p>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Use “Invite job seeker” above to invite someone (such as Harry Crafts III) to start an independent, private workspace.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Display name</th>
                  <th className="py-3 px-4">Email address</th>
                  <th className="py-3 px-4">Invitation status</th>
                  <th className="py-3 px-4">Date invited</th>
                  <th className="py-3 px-4">Invitation expiration</th>
                  <th className="py-3 px-4">Date joined</th>
                  <th className="py-3 px-4 text-right">Available actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredInvitations.map((inv) => {
                  const canResendOrRevoke =
                    inv.effectiveStatus !== "accepted" &&
                    inv.effectiveStatus !== "revoked";
                  const isBusy = rowBusyId === inv.id;

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {inv.recipientDisplayName}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-700">
                        {inv.recipientEmail}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-xs ${statusTextClass(
                            inv.effectiveStatus
                          )}`}
                        >
                          {STATUS_LABELS[inv.effectiveStatus]}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatShortDateTime(inv.createdAtIso)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatShortDateTime(inv.expiresAtIso)}
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                        {inv.effectiveStatus === "accepted" && inv.acceptedAtIso
                          ? formatShortDateTime(inv.acceptedAtIso)
                          : "—"}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {confirmRevokeId === inv.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <span className="text-xs text-red-800 font-medium mr-1">
                              Revoke unredeemed link?
                            </span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleConfirmRevoke(inv.id)}
                              className="px-2.5 py-1 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 rounded-md"
                            >
                              {isBusy ? "Revoking..." : "Confirm revoke"}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmRevokeId(null)}
                              className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedDetailsInvite(inv)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View details</span>
                            </button>
                            {canResendOrRevoke && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleResend(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md whitespace-nowrap shrink-0"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Resend</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setConfirmRevokeId(inv.id)}
                                  className="px-2.5 py-1 text-xs font-medium text-red-800 bg-white border border-red-200 hover:bg-red-50 rounded-md whitespace-nowrap shrink-0"
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 1 & 13: Application vs. Infrastructure Access Disclosure + Immutable Security Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-teal-800 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              Application Permissions vs. Cloud Infrastructure Access
            </h3>
          </div>
          <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
            <p>
              <strong className="text-slate-800">Application-level isolation:</strong>{" "}
              Application Administrator status in Career Launch grants access only to{" "}
              <code className="font-mono">/invitations</code> and{" "}
              <code className="font-mono">/auditLogs</code>. Deployed Cloud Firestore Security Rules explicitly deny administrators read or write access to{" "}
              <code className="font-mono">/users/&#123;otherUid&#125;</code> and all 12 career subcollections. There is no “impersonate user” or “open workspace” capability in the application.
            </p>
            <p>
              <strong className="text-slate-800">Infrastructure transparency:</strong>{" "}
              Because data is stored in Google Cloud Firestore without client-held end-to-end encryption keys, Google Cloud / Firebase project owners with IAM console roles can view raw Firestore documents at the infrastructure layer. Career Launch does not claim zero-knowledge encryption against cloud project operators.
            </p>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Security & Invitation Audit Events
            </h3>
            <span className="font-mono tabular-nums text-xs text-slate-500">
              {auditLogs.length} recorded
            </span>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              No security audit events recorded yet.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
              {auditLogs.slice(0, 20).map((log) => (
                <div
                  key={log.id}
                  className="py-2 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-mono font-medium text-slate-800">
                      {log.eventType}
                    </div>
                    <div className="text-slate-500">
                      {log.summaryCode} · outcome: <strong>{log.outcome}</strong>
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
                    {formatShortDateTime(log.createdAtIso)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: TWO-STEP "INVITE A JOB SEEKER" FORM -> REVIEW & SEND         */}
      {/* ===================================================================== */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-job-seeker-title"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-lg my-8">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
              <div>
                <h2
                  id="invite-job-seeker-title"
                  className="text-lg font-bold text-slate-900"
                >
                  {modalStep === "form"
                    ? "Invite a job seeker"
                    : "Review invitation before sending"}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  This person will create their own account and private career workspace. They will choose what to share.
                </p>
              </div>
              <button
                type="button"
                disabled={submittingInvite}
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalStep === "form" ? (
              <form onSubmit={handleProceedToReview} className="space-y-4" noValidate>
                {/* Section 11 Helper: Prefill Display Name for Harry Crafts III WITHOUT guessing email */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-slate-600">
                  <span>
                    Inviting Harry Crafts III? Prefills his display name only — enter his verified email address directly.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFormDisplayName("Harry Crafts III");
                      setFormFieldErrors((prev) => ({
                        ...prev,
                        displayName: undefined,
                      }));
                    }}
                    className="px-2.5 py-1 font-semibold text-teal-900 bg-white border border-teal-300 hover:bg-teal-50 rounded-md whitespace-nowrap shrink-0"
                  >
                    Prefill “Harry Crafts III”
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="invite-display-name"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Display name <span className="text-red-700">*</span>
                    </label>
                    <input
                      ref={primaryModalInputRef}
                      id="invite-display-name"
                      type="text"
                      required
                      maxLength={120}
                      value={formDisplayName}
                      onChange={(e) => setFormDisplayName(e.target.value)}
                      placeholder="e.g., Harry Crafts III"
                      aria-invalid={Boolean(formFieldErrors.displayName)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                    {formFieldErrors.displayName && (
                      <p className="mt-1 text-xs text-red-700">
                        {formFieldErrors.displayName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="invite-email"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Email address <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      required
                      maxLength={254}
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="Enter verified recipient email"
                      aria-invalid={Boolean(formFieldErrors.email)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                    {formFieldErrors.email && (
                      <p className="mt-1 text-xs text-red-700">
                        {formFieldErrors.email}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="invite-personal-msg"
                      className="text-xs font-medium text-slate-700"
                    >
                      Optional personal message
                    </label>
                    <span className="text-xs font-mono tabular-nums text-slate-500">
                      {formMessage.length} / 500
                    </span>
                  </div>
                  <textarea
                    id="invite-personal-msg"
                    rows={3}
                    maxLength={500}
                    value={formMessage}
                    onChange={(e) => setFormMessage(e.target.value)}
                    placeholder="Optional brief welcome note included in the invitation email (do not include private background details here)."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  />
                  {formFieldErrors.personalMessage && (
                    <p className="mt-1 text-xs text-red-700">
                      {formFieldErrors.personalMessage}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                  <div>
                    <label
                      htmlFor="invite-expiration"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Invitation expiration
                    </label>
                    <select
                      id="invite-expiration"
                      value={formExpirationDays}
                      onChange={(e) =>
                        setFormExpirationDays(Number(e.target.value))
                      }
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value={3}>3 days</option>
                      <option value={7}>7 days (default)</option>
                      <option value={14}>14 days</option>
                      <option value={30}>30 days</option>
                    </select>
                  </div>

                  <div className="text-xs text-slate-600">
                    <button
                      type="button"
                      onClick={() => setShowSuggestionsInput((v) => !v)}
                      className="text-teal-800 hover:underline font-medium"
                    >
                      {showSuggestionsInput
                        ? "Hide unverified onboarding suggestions"
                        : "+ Optional: Add unverified onboarding suggestions (kept out of email)"}
                    </button>
                  </div>
                </div>

                {showSuggestionsInput && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-800">
                      Optional unverified suggestions for recipient’s onboarding review (one per line)
                    </label>
                    <p className="text-xs text-slate-600">
                      Never included in the invitation email. After signing in, the recipient sees these labeled as unverified suggestions from you and can accept, edit, or discard each item.
                    </p>
                    <textarea
                      rows={3}
                      value={formSuggestionsText}
                      onChange={(e) => setFormSuggestionsText(e.target.value)}
                      placeholder="Example: Explore entry-level operations or project coordination roles in Northern Virginia"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                )}

                {formFieldErrors.general && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                    {formFieldErrors.general}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Review invitation
                  </button>
                </div>
              </form>
            ) : (
              /* STEP 2: REVIEW-AND-SEND (Section 5 & Section 6) */
              <div className="space-y-4">
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Recipient email
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold text-slate-900 break-all">
                      {formEmail.trim()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Display name
                    </dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      {formDisplayName.trim()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Access being offered
                    </dt>
                    <dd className="mt-0.5 font-medium text-slate-900">
                      Independent job-seeker workspace.
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-500">
                      Sharing default
                    </dt>
                    <dd className="mt-0.5 font-semibold text-teal-900">
                      Private.
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-slate-500">
                      Invitation expiration date
                    </dt>
                    <dd className="mt-0.5 font-mono tabular-nums text-xs text-slate-800">
                      {new Date(previewExpiresIso).toUTCString()} ({formExpirationDays}{" "}
                      days)
                    </dd>
                  </div>
                </dl>

                {/* Full Section 6 Email Preview */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    Full invitation message preview
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs text-slate-800">
                    <div>
                      <span className="text-slate-500">Subject:</span>{" "}
                      <strong>{emailPreview.subject}</strong>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans leading-relaxed pt-2 border-t border-slate-200 text-slate-700">
                      {emailPreview.body}
                    </pre>
                  </div>
                </div>

                {parsedSuggestedItems.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                    <strong>
                      {parsedSuggestedItems.length} unverified suggestion(s)
                    </strong>{" "}
                    will be presented after sign-in (excluded from the email above) so{" "}
                    {formDisplayName.trim()} can accept, edit, or discard them.
                  </div>
                )}

                {!emailConfigured && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 leading-relaxed">
                    <strong>Email invitations are not configured.</strong> Clicking “Send invitation” will create the bound invitation record with status{" "}
                    <strong>Pending delivery</strong> without claiming an email was sent, and give you the option to generate a single-use manual invite link.
                  </div>
                )}

                {formFieldErrors.general && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                    {formFieldErrors.general}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={submittingInvite}
                    onClick={() => setModalStep("form")}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={submittingInvite}
                    onClick={handleSendInvitationConfirmed}
                    className="inline-flex items-center gap-2 px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {submittingInvite && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    <span>
                      {submittingInvite ? "Processing..." : "Send invitation"}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: INVITATION DETAILS VIEWER                                    */}
      {/* ===================================================================== */}
      {selectedDetailsInvite && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-details-heading"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-lg">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
              <div>
                <h3
                  id="invite-details-heading"
                  className="text-base font-bold text-slate-900"
                >
                  Invitation Details
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {selectedDetailsInvite.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetailsInvite(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-slate-500">Display name</dt>
                <dd className="font-semibold text-slate-900 mt-0.5">
                  {selectedDetailsInvite.recipientDisplayName}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Email address</dt>
                <dd className="font-mono text-slate-900 mt-0.5 break-all">
                  {selectedDetailsInvite.recipientEmail}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Invitation status</dt>
                <dd
                  className={`mt-0.5 ${statusTextClass(
                    selectedDetailsInvite.effectiveStatus
                  )}`}
                >
                  {STATUS_LABELS[selectedDetailsInvite.effectiveStatus]}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Delivery channel</dt>
                <dd className="text-slate-900 mt-0.5">
                  {selectedDetailsInvite.deliveryChannel} (attempts:{" "}
                  <span className="font-mono tabular-nums">
                    {selectedDetailsInvite.sendAttemptCount}
                  </span>
                  )
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Provider / delivery result</dt>
                <dd className="text-slate-800 mt-0.5 leading-relaxed">
                  {selectedDetailsInvite.deliveryProviderResult || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Date invited</dt>
                <dd className="font-mono tabular-nums text-slate-800 mt-0.5">
                  {formatShortDateTime(selectedDetailsInvite.createdAtIso)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Expires</dt>
                <dd className="font-mono tabular-nums text-slate-800 mt-0.5">
                  {formatShortDateTime(selectedDetailsInvite.expiresAtIso)}
                </dd>
              </div>
              {selectedDetailsInvite.acceptedAtIso && (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Date joined</dt>
                  <dd className="font-mono tabular-nums text-teal-900 font-semibold mt-0.5">
                    {formatShortDateTime(selectedDetailsInvite.acceptedAtIso)} (Workspace isolated & private)
                  </dd>
                </div>
              )}
              {selectedDetailsInvite.personalMessage && (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Personal note included</dt>
                  <dd className="text-slate-800 mt-0.5 whitespace-pre-wrap bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    {selectedDetailsInvite.personalMessage}
                  </dd>
                </div>
              )}
            </dl>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              {selectedDetailsInvite.effectiveStatus !== "accepted" &&
              selectedDetailsInvite.effectiveStatus !== "revoked" ? (
                <button
                  type="button"
                  disabled={rowBusyId === selectedDetailsInvite.id}
                  onClick={() => {
                    const targetId = selectedDetailsInvite.id;
                    setSelectedDetailsInvite(null);
                    handleGenerateManualLink(targetId);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0"
                >
                  <KeyRound className="w-3.5 h-3.5 text-teal-800" />
                  <span>Generate single-use manual invite link</span>
                </button>
              ) : (
                <span className="text-xs text-slate-500">
                  Private career activity is never visible to administrators.
                </span>
              )}

              <button
                type="button"
                onClick={() => setSelectedDetailsInvite(null)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: SINGLE-USE MANUAL SECURE INVITE LINK (Section 14)            */}
      {/* ===================================================================== */}
      {manualLinkResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-link-heading"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-800 shrink-0" />
                <h3
                  id="manual-link-heading"
                  className="text-base font-bold text-slate-900"
                >
                  Single-Use Secure Invitation Link
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setManualLinkResult(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md"
                aria-label="Close manual link dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-1 leading-relaxed">
              <p className="font-semibold">
                Handle this link carefully — it is shown only once and is not stored in plain text.
              </p>
              <p>
                Deliver it directly to{" "}
                <strong>{manualLinkResult.invitation.recipientDisplayName}</strong> (
                <span className="font-mono">
                  {manualLinkResult.invitation.recipientEmail}
                </span>
                ). It expires on{" "}
                <span className="font-mono tabular-nums">
                  {new Date(
                    manualLinkResult.invitation.expiresAtIso
                  ).toUTCString()}
                </span>{" "}
                and can only be redeemed after signing in with that exact verified email address. Any previous link for this invitation is now invalid.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Single-use invitation URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={manualLinkResult.manualInviteUrl}
                  className="flex-1 px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                />
                <button
                  type="button"
                  onClick={() =>
                    copyText(manualLinkResult.manualInviteUrl, "url")
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0"
                >
                  {copiedKey === "url" ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === "url" ? "Copied" : "Copy link"}</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">
                  Full invitation message (with link)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `Subject: ${manualLinkResult.emailSubject}\n\n${manualLinkResult.emailBodyWithLink}`,
                      "body"
                    )
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline"
                >
                  {copiedKey === "body" ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>
                    {copiedKey === "body" ? "Copied message" : "Copy full message"}
                  </span>
                </button>
              </div>
              <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap font-sans text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 leading-relaxed">
                {manualLinkResult.emailBodyWithLink}
              </pre>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
              <a
                href={manualLinkResult.manualInviteUrl}
                className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Preview landing page in this tab</span>
              </a>
              <button
                type="button"
                onClick={() => setManualLinkResult(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
