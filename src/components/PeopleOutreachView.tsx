import React, { useMemo, useState } from "react";
import { Check, Copy, Lock, Plus, ShieldAlert } from "lucide-react";
import { getTodayIsoDate } from "../data/initialData";
import { requestTruthfulAiDraft } from "../services/apiClient";
import {
  Contact,
  Evidence,
  Opportunity,
  OutreachDraft,
  OutreachMessageType,
  Profile,
  Task,
} from "../types/models";
import { buildOutreachDraftLocally } from "../utils/analysisEngine";

interface PeopleOutreachViewProps {
  profile: Profile;
  evidence: Evidence[];
  contacts: Contact[];
  opportunities: Opportunity[];
  outreachDrafts: OutreachDraft[];
  allowServerSideAi: boolean;
  onAddContact: (contact: Omit<Contact, "id">) => Promise<string | null>;
  onUpdateContact: (contact: Contact) => Promise<boolean>;
  onDeleteContact: (id: string) => Promise<boolean>;
  onSaveOutreachDraft: (draft: OutreachDraft) => Promise<boolean>;
  onAddTask: (
    task: Omit<Task, "id" | "completed" | "completedAt" | "archived">
  ) => Promise<boolean>;
}

const MESSAGE_TYPES: OutreachMessageType[] = [
  "Connection request",
  "Informational interview request",
  "Referral request",
  "Recruiter message",
  "Follow-up",
  "Thank-you note",
];

export const PeopleOutreachView: React.FC<PeopleOutreachViewProps> = ({
  profile,
  evidence,
  contacts,
  opportunities,
  outreachDrafts,
  allowServerSideAi,
  onAddContact,
  onUpdateContact,
  onDeleteContact,
  onSaveOutreachDraft,
  onAddTask,
}) => {
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    contacts[0]?.id ?? null
  );

  // Contact form fields
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [role, setRole] = useState("");
  const [roleVerified, setRoleVerified] = useState(false);
  const [relationship, setRelationship] = useState("");
  const [source, setSource] = useState("");
  const [channelNote, setChannelNote] = useState("");
  const [lastContactDate, setLastContactDate] = useState("");
  const [nextAction, setNextAction] = useState("Send concise introduction or informational request");
  const [nextDueDate, setNextDueDate] = useState(getTodayIsoDate(2));
  const [replyStatus, setReplyStatus] =
    useState<Contact["replyStatus"]>("Not contacted yet");
  const [doNotContact, setDoNotContact] = useState(false);
  const [linkedOppId, setLinkedOppId] = useState("");
  const [notes, setNotes] = useState("");

  // Outreach drafter fields
  const [msgType, setMsgType] = useState<OutreachMessageType>(
    "Informational interview request"
  );
  const [draftBody, setDraftBody] = useState("");
  const [draftMeta, setDraftMeta] = useState<{
    evidenceUsed: string[];
    missingInformation: string[];
    reasoning: string;
    suggestedNextAction: string;
  } | null>(null);
  const [approvedExactRecipientAndContent, setApprovedExactRecipientAndContent] =
    useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? contacts[0] ?? null,
    [contacts, selectedContactId]
  );

  const flashBanner = (msg: string) => {
    setBannerMsg(msg);
    window.setTimeout(() => setBannerMsg(null), 4000);
  };

  const resetForm = () => {
    setEditingContactId(null);
    setName("");
    setOrganization("");
    setRole("");
    setRoleVerified(false);
    setRelationship("");
    setSource("");
    setChannelNote("");
    setLastContactDate("");
    setNextAction("Send concise introduction or informational request");
    setNextDueDate(getTodayIsoDate(2));
    setReplyStatus("Not contacted yet");
    setDoNotContact(false);
    setLinkedOppId("");
    setNotes("");
    setShowContactForm(false);
  };

  const openEditContact = (c: Contact) => {
    setEditingContactId(c.id);
    setName(c.name);
    setOrganization(c.organization);
    setRole(c.role);
    setRoleVerified(c.roleVerified);
    setRelationship(c.relationship);
    setSource(c.source);
    setChannelNote(c.contactChannelNote);
    setLastContactDate(c.lastContactDate);
    setNextAction(c.nextAction);
    setNextDueDate(c.nextActionDueDate);
    setReplyStatus(c.replyStatus);
    setDoNotContact(c.doNotContact);
    setLinkedOppId(c.linkedOpportunityId);
    setNotes(c.notes);
    setShowContactForm(true);
  };

  const handleSaveContactForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const finalReplyStatus: Contact["replyStatus"] = doNotContact
      ? "Do not contact"
      : replyStatus;

    if (editingContactId) {
      const ok = await onUpdateContact({
        id: editingContactId,
        name: name.trim(),
        organization: organization.trim(),
        role: role.trim(),
        roleVerified,
        relationship: relationship.trim(),
        source: source.trim(),
        contactChannelNote: channelNote.trim(),
        lastContactDate,
        nextAction: doNotContact ? "Respect request not to contact" : nextAction.trim(),
        nextActionDueDate: doNotContact ? "" : nextDueDate,
        replyStatus: finalReplyStatus,
        doNotContact,
        linkedOpportunityId: linkedOppId,
        notes: notes.trim(),
      });
      if (ok) {
        flashBanner("Saved contact update to database.");
        resetForm();
      }
    } else {
      const createdId = await onAddContact({
        name: name.trim(),
        organization: organization.trim(),
        role: role.trim(),
        roleVerified,
        relationship: relationship.trim() || "Professional / alum connection",
        source: source.trim() || "Direct research",
        contactChannelNote: channelNote.trim(),
        lastContactDate,
        nextAction: doNotContact ? "Respect request not to contact" : nextAction.trim(),
        nextActionDueDate: doNotContact ? "" : nextDueDate,
        replyStatus: finalReplyStatus,
        doNotContact,
        linkedOpportunityId: linkedOppId,
        notes: notes.trim(),
      });
      if (!createdId) return;
      setSelectedContactId(createdId);
      if (!doNotContact && nextAction.trim()) {
        await onAddTask({
          title: `Outreach follow-up with ${name.trim()} (${organization.trim() || "Contact"}): ${nextAction.trim()}`,
          whyItMatters:
            "Builds real human context and referrals instead of relying solely on cold application portals.",
          category: "relationship",
          estimatedMinutes: 15,
          dueDate: nextDueDate || getTodayIsoDate(2),
          scheduledBucket:
            nextDueDate <= getTodayIsoDate(0) ? "today" : "tomorrow",
          linkedContactId: createdId,
          linkedOpportunityId: linkedOppId || undefined,
        });
      }
      flashBanner("Saved contact and follow-up action to database.");
      resetForm();
    }
  };

  const handleGenerateDraft = async () => {
    if (!selectedContact || selectedContact.doNotContact) return;
    setIsGenerating(true);
    setApprovedExactRecipientAndContent(false);

    const linkedOpp = opportunities.find(
      (o) => o.id === selectedContact.linkedOpportunityId
    );
    const localResult = buildOutreachDraftLocally(
      msgType,
      selectedContact,
      linkedOpp,
      profile,
      evidence
    );

    const aiResult = await requestTruthfulAiDraft({
      draftType: `Outreach ${msgType}`,
      opportunity: linkedOpp,
      evidence,
      contact: {
        id: selectedContact.id,
        name: selectedContact.name,
        organization: selectedContact.organization,
        role: selectedContact.roleVerified
          ? selectedContact.role
          : `${selectedContact.role || "team member"} (exact hiring authority unverified)`,
        relationship: selectedContact.relationship,
      },
      allowServerSideAi,
    });

    if (aiResult) {
      setDraftBody(aiResult.draftText);
      setDraftMeta({
        evidenceUsed: aiResult.evidenceUsed,
        missingInformation: aiResult.missingInformation,
        reasoning: aiResult.reasoning,
        suggestedNextAction: aiResult.suggestedNextAction,
      });
    } else {
      setDraftBody(localResult.bodyText);
      setDraftMeta({
        evidenceUsed: localResult.evidenceUsed,
        missingInformation: localResult.missingInformation,
        reasoning: localResult.reasoning,
        suggestedNextAction: localResult.suggestedNextAction,
      });
    }
    setIsGenerating(false);
  };

  const hasUnresolvedPlaceholders = /\[PLACEHOLDER:[^\]]*\]/i.test(draftBody);

  const handleApproveAndCopy = async () => {
    if (!selectedContact || !approvedExactRecipientAndContent || hasUnresolvedPlaceholders) {
      return;
    }

    const record: OutreachDraft = {
      id: `outreach-${Date.now()}`,
      contactId: selectedContact.id,
      opportunityId: selectedContact.linkedOpportunityId,
      messageType: msgType,
      recipientSummary: `${selectedContact.name} (${selectedContact.organization})`,
      bodyText: draftBody,
      evidenceUsed: draftMeta?.evidenceUsed ?? [],
      missingInformation: draftMeta?.missingInformation ?? [],
      reasoning: draftMeta?.reasoning ?? "Approved by workspace owner",
      suggestedNextAction: "Send manually in your chosen tool and log reply date.",
      approvedByNora: true,
      approvedAt: new Date().toISOString(),
      sentState: "approved",
      manuallySentLoggedAt: null,
      createdAt: new Date().toISOString(),
    };
    const ok = await onSaveOutreachDraft(record);
    if (!ok) return;

    try {
      await navigator.clipboard.writeText(draftBody);
      setCopiedFeedback(true);
      window.setTimeout(() => setCopiedFeedback(false), 2500);
    } catch {
      // Clipboard fallback ignored cleanly
    }
    flashBanner("Approved message saved to database and copied to clipboard. Nothing is sent automatically.");
  };

  const handleLogManualSend = async () => {
    if (!selectedContact || !approvedExactRecipientAndContent || hasUnresolvedPlaceholders) {
      return;
    }
    const today = getTodayIsoDate(0);
    const followUpDate = getTodayIsoDate(7);
    const sentDraft: OutreachDraft = {
      id: `outreach-sent-${Date.now()}`,
      contactId: selectedContact.id,
      opportunityId: selectedContact.linkedOpportunityId,
      messageType: msgType,
      recipientSummary: `${selectedContact.name} (${selectedContact.organization})`,
      bodyText: draftBody,
      evidenceUsed: draftMeta?.evidenceUsed ?? [],
      missingInformation: draftMeta?.missingInformation ?? [],
      reasoning: draftMeta?.reasoning ?? "Logged manual send by workspace owner",
      suggestedNextAction: `Follow up after ${followUpDate} if no reply.`,
      approvedByNora: true,
      approvedAt: new Date().toISOString(),
      sentState: "logged_sent",
      manuallySentLoggedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const savedDraftOk = await onSaveOutreachDraft(sentDraft);
    if (!savedDraftOk) return;

    const updatedOk = await onUpdateContact({
      ...selectedContact,
      lastContactDate: today,
      replyStatus: "Awaiting reply",
      nextAction: `Check for reply or send polite 1-time follow-up after ${followUpDate}`,
      nextActionDueDate: followUpDate,
    });
    if (!updatedOk) return;

    await onAddTask({
      title: `Follow up with ${selectedContact.name} (${selectedContact.organization}) if no reply`,
      whyItMatters: "Tracks calm, respectful follow-through one week after outreach.",
      category: "followup",
      estimatedMinutes: 10,
      dueDate: followUpDate,
      scheduledBucket: "later",
      linkedContactId: selectedContact.id,
      linkedOpportunityId: selectedContact.linkedOpportunityId || undefined,
    });
    flashBanner(`Logged manual outreach to ${selectedContact.name} in database and scheduled 7-day follow-up.`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            People & Outreach
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Track real professional contacts, informational conversations, and recruiters. Messages are grounded in genuine common ground and never leave this workspace without your manual send.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowContactForm(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg whitespace-nowrap shrink-0 self-start"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Contact</span>
        </button>
      </div>

      {bannerMsg && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5 text-xs font-medium text-teal-900">
          {bannerMsg}
        </div>
      )}

      {/* Add / Edit Contact Form */}
      {showContactForm && (
        <form
          onSubmit={handleSaveContactForm}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">
            {editingContactId ? "Edit Contact Record" : "Add Contact & Next Follow-Up"}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Organization
              </label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="Employer / clinic / university"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700">Role / Title</label>
                <label className="inline-flex items-center gap-1 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={roleVerified}
                    onChange={(e) => setRoleVerified(e.target.checked)}
                    className="rounded border-slate-300 text-teal-800"
                  />
                  <span>Verified title</span>
                </label>
              </div>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Do not claim hiring manager unless verified"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Relationship / Common Ground
              </label>
              <input
                type="text"
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder={
                  profile.fullName.trim().toLowerCase() === "nora crafts"
                    ? "e.g., Former Little Leaves colleague, GMU Psych alum"
                    : "e.g., Former colleague, university alum, verified recruiter"
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Source
              </label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g., Official team page, LinkedIn, former supervisor"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Verified channel (never guess personal emails)
              </label>
              <input
                type="text"
                value={channelNote}
                onChange={(e) => setChannelNote(e.target.value)}
                placeholder="e.g., LinkedIn profile URL or published work email"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Linked opportunity (optional)
              </label>
              <select
                value={linkedOppId}
                onChange={(e) => setLinkedOppId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">None (general exploration)</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} — {o.employer}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Reply status
              </label>
              <select
                value={replyStatus}
                onChange={(e) =>
                  setReplyStatus(e.target.value as Contact["replyStatus"])
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="Not contacted yet">Not contacted yet</option>
                <option value="Awaiting reply">Awaiting reply</option>
                <option value="Replied — conversation active">
                  Replied — conversation active
                </option>
                <option value="No response">No response</option>
                <option value="Do not contact">Do not contact</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Last contact date
              </label>
              <input
                type="date"
                value={lastContactDate}
                onChange={(e) => setLastContactDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Next action
              </label>
              <input
                type="text"
                disabled={doNotContact}
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Next action due date
              </label>
              <input
                type="date"
                disabled={doNotContact}
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-red-800 cursor-pointer">
              <input
                type="checkbox"
                checked={doNotContact}
                onChange={(e) => setDoNotContact(e.target.checked)}
                className="rounded border-slate-300 text-red-700"
              />
              <span>Do not contact (locks outreach drafting to respect boundary)</span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
              >
                {editingContactId ? "Save Contact" : "Add Contact"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Relationship Tracker Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Relationship Tracker ({contacts.length})
          </h2>
          <span className="text-xs text-slate-500">
            Click a row to draft grounded outreach
          </span>
        </div>

        {contacts.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">
              No contacts recorded yet.
            </p>
            <p className="text-xs text-slate-600 max-w-lg mx-auto">
              {profile.fullName.trim().toLowerCase() === "nora crafts"
                ? "Start with 1–2 genuine connections — such as a former Little Leaves supervisor/colleague, a George Mason Psychology alum working in healthcare operations, or a verified recruiter listed on an employer’s official posting."
                : "Start with 1–2 genuine connections — such as a former supervisor or colleague, an alum working in your target field, or a verified recruiter listed on an employer’s official posting."}
            </p>
            <button
              type="button"
              onClick={() => setShowContactForm(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
            >
              Add First Contact
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-700">
                  <th className="py-3 px-4 font-semibold">Name</th>
                  <th className="py-3 px-4 font-semibold">Organization</th>
                  <th className="py-3 px-4 font-semibold">Role</th>
                  <th className="py-3 px-4 font-semibold">Relationship</th>
                  <th className="py-3 px-4 font-semibold">Source</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">Last Contact</th>
                  <th className="py-3 px-4 font-semibold">Next Action</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {contacts.map((c) => {
                  const isSelected = selectedContact?.id === c.id;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        setSelectedContactId(c.id);
                        setApprovedExactRecipientAndContent(false);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? "bg-teal-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {c.name}
                        {c.doNotContact && (
                          <span className="block text-red-700 font-normal">
                            Do not contact
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700">{c.organization || "—"}</td>
                      <td className="py-3 px-4 text-slate-700">
                        {c.role || "Unverified"}
                        {!c.roleVerified && c.role ? " (unverified)" : ""}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{c.relationship || "—"}</td>
                      <td className="py-3 px-4 text-slate-600">{c.source || "—"}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {c.lastContactDate || "Never"} · {c.replyStatus}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {c.nextAction}{" "}
                        {c.nextActionDueDate ? (
                          <span className="font-mono tabular-nums text-slate-500">
                            ({c.nextActionDueDate})
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="py-3 px-4 text-right whitespace-nowrap space-x-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => openEditContact(c)}
                          className="text-teal-800 hover:underline font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteContact(c.id)}
                          className="text-red-700 hover:underline font-medium"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Outreach Drafter & Explicit Approval Gate */}
      {selectedContact && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Outreach Draft Workspace — {selectedContact.name}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {selectedContact.organization || "Organization unverified"} ·{" "}
                {selectedContact.role || "Role unverified"} · Channel:{" "}
                {selectedContact.contactChannelNote || "Not recorded (never guess personal email)"}
              </p>
            </div>

            {!selectedContact.doNotContact && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <select
                  value={msgType}
                  onChange={(e) => {
                    setMsgType(e.target.value as OutreachMessageType);
                    setApprovedExactRecipientAndContent(false);
                  }}
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {MESSAGE_TYPES.map((mt) => (
                    <option key={mt} value={mt}>
                      {mt}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleGenerateDraft}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {isGenerating ? "Drafting..." : "Draft Grounded Message"}
                </button>
              </div>
            )}
          </div>

          {selectedContact.doNotContact ? (
            <div className="p-4 rounded-lg bg-red-50/70 border border-red-200 flex items-center gap-3 text-xs text-red-900">
              <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
              <span>
                This contact is marked <strong>Do not contact</strong>. Outreach drafting and follow-up reminders are disabled to respect their preference.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {draftMeta && (
                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-xs text-slate-700">
                  <div>
                    <strong>Reasoning:</strong> {draftMeta.reasoning}
                  </div>
                  <div>
                    <strong>Evidence used:</strong> {draftMeta.evidenceUsed.join(" · ")}
                  </div>
                  {draftMeta.missingInformation.length > 0 && (
                    <div className="text-amber-900">
                      <strong>Verify before sending:</strong>{" "}
                      {draftMeta.missingInformation.join(" · ")}
                    </div>
                  )}
                </div>
              )}

              <textarea
                rows={7}
                value={draftBody}
                onChange={(e) => {
                  setDraftBody(e.target.value);
                  setApprovedExactRecipientAndContent(false);
                }}
                placeholder="Click 'Draft Grounded Message' above or write your note here..."
                className="w-full p-3.5 text-sm leading-relaxed border border-slate-300 rounded-lg bg-white"
              />

              {/* Explicit Approval & Disabled External Integration Disclosure */}
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/80 space-y-3">
                <div className="flex items-start gap-2 text-xs text-slate-600">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>External auto-sending is disabled:</strong> Direct email/LinkedIn sending integrations are not enabled in this workspace so nothing can ever be sent externally without you. Review and approve the exact recipient and final wording below to copy and log a manual send.
                  </span>
                </div>

                {hasUnresolvedPlaceholders && (
                  <p className="text-xs font-medium text-amber-900">
                    Please replace all <code className="font-mono">[PLACEHOLDER: ...]</code> brackets in your message before approving.
                  </p>
                )}

                <label className="flex items-start gap-2.5 text-xs font-medium text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!draftBody.trim() || hasUnresolvedPlaceholders}
                    checked={approvedExactRecipientAndContent}
                    onChange={(e) =>
                      setApprovedExactRecipientAndContent(e.target.checked)
                    }
                    className="mt-0.5 rounded border-slate-300 text-teal-800"
                  />
                  <span>
                    I approve this exact final message for{" "}
                    <strong>{selectedContact.name}</strong> ({selectedContact.organization || "verified recipient"}) and have verified every factual statement.
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={
                      !approvedExactRecipientAndContent ||
                      !draftBody.trim() ||
                      hasUnresolvedPlaceholders
                    }
                    onClick={handleApproveAndCopy}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 disabled:opacity-40 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {copiedFeedback ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Approved Text</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Approved Message</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={
                      !approvedExactRecipientAndContent ||
                      !draftBody.trim() ||
                      hasUnresolvedPlaceholders
                    }
                    onClick={handleLogManualSend}
                    className="px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Log Manual Send & Queue 7-Day Follow-Up
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Direct sending integration is disabled in Phase 1/2 to guarantee human control."
                    className="px-3.5 py-2 text-xs font-medium text-slate-400 bg-slate-100 border border-slate-200 rounded-lg cursor-not-allowed whitespace-nowrap shrink-0"
                  >
                    Send Externally (Integration Disabled)
                  </button>
                </div>
              </div>

              {outreachDrafts.filter((d) => d.contactId === selectedContact.id).length >
                0 && (
                <div className="pt-2 text-xs text-slate-500">
                  {
                    outreachDrafts.filter((d) => d.contactId === selectedContact.id)
                      .length
                  }{" "}
                  approved draft(s) saved in local history for {selectedContact.name}.
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
