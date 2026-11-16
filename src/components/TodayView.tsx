import React, { useMemo, useState } from "react";
import { ArrowRight, Check, Clock, Plus } from "lucide-react";
import { getTodayIsoDate } from "../data/initialData";
import {
  NavSection,
  OnboardingWizardState,
  Opportunity,
  Profile,
  Task,
  TaskCategory,
} from "../types/models";

interface TodayViewProps {
  profile: Profile;
  tasks: Task[];
  opportunities: Opportunity[];
  availableMinutes: number;
  onboardingWizard?: OnboardingWizardState;
  onResumeOnboardingWizard?: () => void;
  onChangeAvailableMinutes: (mins: number) => void;
  onUpdateTask: (task: Task) => void;
  onAddTask: (task: Omit<Task, "id" | "completed" | "completedAt" | "archived">) => void;
  onNavigate: (section: NavSection, focusOpportunityId?: string) => void;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  opportunity: "High-value opportunity action",
  relationship: "Relationship & outreach action",
  preparation: "Preparation or learning action",
  followup: "Time-sensitive follow-up",
};

const TIME_BUDGET_OPTIONS = [20, 30, 45, 60, 90];

export const TodayView: React.FC<TodayViewProps> = ({
  profile,
  tasks,
  opportunities,
  availableMinutes,
  onboardingWizard,
  onResumeOnboardingWizard,
  onChangeAvailableMinutes,
  onUpdateTask,
  onAddTask,
  onNavigate,
}) => {
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newWhy, setNewWhy] = useState("");
  const [newCategory, setNewCategory] = useState<TaskCategory>("opportunity");
  const [newMinutes, setNewMinutes] = useState(15);
  const [newBucket, setNewBucket] = useState<"today" | "tomorrow">("today");

  const todayIso = getTodayIsoDate(0);
  const tomorrowIso = getTodayIsoDate(1);

  const activeTasks = useMemo(
    () => tasks.filter((t) => !t.archived && !t.completed),
    [tasks]
  );

  const completedToday = useMemo(
    () =>
      tasks.filter(
        (t) => !t.archived && t.completed && t.completedAt?.startsWith(todayIso)
      ),
    [tasks, todayIso]
  );

  // Build balanced 3-5 action plan respecting availableMinutes and deadlines
  const { todaysPlan, tomorrowsPlan, laterPlan } = useMemo(() => {
    const candidatesForToday = activeTasks
      .filter((t) => t.scheduledBucket === "today" || t.dueDate <= todayIso)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const selected: Task[] = [];
    let runningMinutes = 0;

    // First try to pick 1 from each core category so the day is balanced
    const desiredCategories: TaskCategory[] = [
      "followup",
      "opportunity",
      "relationship",
      "preparation",
    ];

    for (const cat of desiredCategories) {
      const match = candidatesForToday.find(
        (t) =>
          t.category === cat &&
          !selected.some((s) => s.id === t.id) &&
          (selected.length === 0 || runningMinutes + t.estimatedMinutes <= availableMinutes + 10)
      );
      if (match && selected.length < 5) {
        selected.push(match);
        runningMinutes += match.estimatedMinutes;
      }
    }

    // Fill up to 3–5 actions if time budget allows
    for (const t of candidatesForToday) {
      if (selected.length >= 5) break;
      if (selected.some((s) => s.id === t.id)) continue;
      if (selected.length < 3 || runningMinutes + t.estimatedMinutes <= availableMinutes) {
        selected.push(t);
        runningMinutes += t.estimatedMinutes;
      }
    }

    // If fewer than 3 items were in "today", pull top items from tomorrow if time permits
    if (selected.length < 3) {
      const tomorrowPool = activeTasks.filter(
        (t) => t.scheduledBucket === "tomorrow" && !selected.some((s) => s.id === t.id)
      );
      for (const t of tomorrowPool) {
        if (selected.length >= 3) break;
        if (runningMinutes + t.estimatedMinutes <= availableMinutes + 10) {
          selected.push(t);
          runningMinutes += t.estimatedMinutes;
        }
      }
    }

    const selectedIds = new Set(selected.map((s) => s.id));
    const tomorrowItems = activeTasks.filter(
      (t) => !selectedIds.has(t.id) && (t.scheduledBucket === "tomorrow" || t.scheduledBucket === "today")
    );
    const laterItems = activeTasks.filter(
      (t) => !selectedIds.has(t.id) && t.scheduledBucket === "later"
    );

    return {
      todaysPlan: selected,
      tomorrowsPlan: tomorrowItems,
      laterPlan: laterItems,
    };
  }, [activeTasks, availableMinutes, todayIso]);

  const totalPlanMinutes = todaysPlan.reduce((sum, t) => sum + t.estimatedMinutes, 0);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTask({
      title: newTitle.trim(),
      whyItMatters:
        newWhy.trim() ||
        "Added to keep concrete job-search next steps organized.",
      category: newCategory,
      estimatedMinutes: Math.max(5, Number(newMinutes) || 15),
      dueDate: newBucket === "today" ? todayIso : tomorrowIso,
      scheduledBucket: newBucket,
    });
    setNewTitle("");
    setNewWhy("");
    setShowNewTaskForm(false);
  };

  const getLinkedOpportunityName = (oppId?: string) => {
    if (!oppId) return null;
    const found = opportunities.find((o) => o.id === oppId);
    return found ? `${found.title} — ${found.employer}` : null;
  };

  const handleJumpToTaskContext = (task: Task) => {
    const lower = task.title.toLowerCase();
    if (lower.includes("45-second") || lower.includes("crm") || task.category === "preparation") {
      onNavigate("practice");
    } else if (lower.includes("rbt") || lower.includes("little leaves") || lower.includes("software")) {
      onNavigate("profile");
    } else if (task.linkedOpportunityId) {
      onNavigate("opportunities", task.linkedOpportunityId);
    } else if (task.category === "relationship") {
      onNavigate("people");
    } else {
      onNavigate("discover");
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Today’s Plan
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-2xl">
            Three to five focused actions chosen for real deadlines, honest preparation, and steady momentum. Adjust your available time whenever your schedule changes.
          </p>
        </div>

        {/* Available Time Selector */}
        <div className="flex flex-col items-start md:items-end gap-1.5 shrink-0">
          <span className="text-xs font-medium text-slate-600">
            Available time today
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {TIME_BUDGET_OPTIONS.map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => onChangeAvailableMinutes(mins)}
                className={`px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  availableMinutes === mins
                    ? "bg-white text-slate-950 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {mins}m
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Paused 6-Step First-Login Setup Banner (Section 10) */}
      {onboardingWizard &&
        !onboardingWizard.completed &&
        onResumeOnboardingWizard && (
          <section
            aria-label="Resume guided workspace setup"
            className="bg-teal-50/70 border border-teal-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-teal-950">
                Continue setting up your private workspace (Step{" "}
                <span className="font-mono tabular-nums">
                  {onboardingWizard.currentStep}
                </span>{" "}
                of 6)
              </h2>
              <p className="text-sm text-teal-900 max-w-2xl">
                Pick up right where you left off to review work preferences, experience, career interests, and privacy settings.
              </p>
            </div>
            <button
              type="button"
              onClick={onResumeOnboardingWizard}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              Resume Setup
            </button>
          </section>
        )}

      {/* Onboarding & Starting Profile Verification Invitation */}
      {(!onboardingWizard || onboardingWizard.completed) &&
        (!profile.profileVerifiedByNora ||
          !profile.constraints.onboardingReviewed) && (
          <section
            aria-label="Onboarding setup check"
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900">
                Verify your profile & job-search constraints
              </h2>
              <p className="text-sm text-slate-600 max-w-2xl">
                {profile.fullName.trim().toLowerCase() === "nora crafts"
                  ? "Your starting details (Oakton, VA; GMU Psychology BA; Little Leaves RBT experience) are loaded for review. Confirm your salary floor, commute preferences, RBT status, and Little Leaves software — “Not sure yet” is always allowed."
                  : "Review your preferred location, salary floor, benefits needs, and work arrangement preferences — choosing “Not sure yet” is always allowed."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("profile")}
              className="px-4 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              Review Profile & Constraints
            </button>
          </section>
        )}

      {/* Main Today Plan Section */}
      <section aria-labelledby="today-actions-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <h2 id="today-actions-heading" className="text-lg font-semibold text-slate-900">
              Priority Actions for Today
            </h2>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-xs">
              {todaysPlan.length} {todaysPlan.length === 1 ? "action" : "actions"} ({totalPlanMinutes} min estimated)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowNewTaskForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Action</span>
          </button>
        </div>

        {showNewTaskForm && (
          <form
            onSubmit={handleCreateTask}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">Add a Priority Action</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Action title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Check official careers page for Fairfax pediatric clinic coordinator role"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Why this matters (plain English)
                </label>
                <input
                  type="text"
                  value={newWhy}
                  onChange={(e) => setNewWhy(e.target.value)}
                  placeholder="e.g., Verifies whether base salary meets dependable income goal before drafting."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Category
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as TaskCategory)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="opportunity">High-value opportunity action</option>
                  <option value="relationship">Relationship & outreach action</option>
                  <option value="preparation">Preparation or learning action</option>
                  <option value="followup">Time-sensitive follow-up</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Est. minutes
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={newMinutes}
                    onChange={(e) => setNewMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    When
                  </label>
                  <select
                    value={newBucket}
                    onChange={(e) => setNewBucket(e.target.value as "today" | "tomorrow")}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewTaskForm(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
              >
                Save Action
              </button>
            </div>
          </form>
        )}

        {todaysPlan.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-3">
            <p className="text-base font-medium text-slate-900">
              Nothing else scheduled for today.
            </p>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              You can stop here for the day, pull an item forward from Tomorrow’s Priorities below, or evaluate a new job posting.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("discover")}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg"
            >
              Evaluate a Job Opening
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {todaysPlan.map((task, index) => {
              const linkedOppName = getLinkedOpportunityName(task.linkedOpportunityId);
              const isOverdue = task.dueDate < todayIso;
              return (
                <div key={task.id} className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5 max-w-3xl">
                    {/* Clean unboxed metadata row */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono tabular-nums font-semibold text-slate-700">
                        0{index + 1}.
                      </span>
                      <span>{CATEGORY_LABELS[task.category]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Clock className="w-3 h-3" />
                        {task.estimatedMinutes} min
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-mono tabular-nums ${isOverdue ? "text-amber-700 font-medium" : ""}`}>
                        {isOverdue ? `Target date was ${task.dueDate}` : `Target ${task.dueDate}`}
                      </span>
                      {linkedOppName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-700">{linkedOppName}</span>
                        </>
                      )}
                    </div>

                    <h3 className="text-base font-semibold text-slate-900">
                      {task.title}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      <strong className="font-medium text-slate-700">Why this matters:</strong>{" "}
                      {task.whyItMatters}
                    </p>
                  </div>

                  {/* Clean single-line action buttons */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 pt-1">
                    <button
                      type="button"
                      onClick={() => handleJumpToTaskContext(task)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateTask({
                          ...task,
                          completed: true,
                          completedAt: new Date().toISOString(),
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Mark Done</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateTask({
                          ...task,
                          scheduledBucket: "tomorrow",
                          dueDate: tomorrowIso,
                        })
                      }
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Move to Tomorrow
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tomorrow's Priorities & Reschedule Queue (Acceptance Test #9) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <section
          aria-labelledby="tomorrow-priorities-heading"
          className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <h2 id="tomorrow-priorities-heading" className="text-base font-semibold text-slate-900">
                Tomorrow’s Priorities ({tomorrowIso})
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {tomorrowsPlan.length} queued
              </span>
            </div>

            {tomorrowsPlan.length === 0 ? (
              <p className="text-sm text-slate-600 py-2">
                No tasks queued for tomorrow yet. Any task moved from Today or added for tomorrow will appear here automatically.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {tomorrowsPlan.map((task) => (
                  <li key={task.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-slate-900">{task.title}</div>
                      <div className="text-xs text-slate-500">
                        {CATEGORY_LABELS[task.category]} ·{" "}
                        <span className="font-mono tabular-nums">{task.estimatedMinutes} min</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTask({
                            ...task,
                            scheduledBucket: "today",
                            dueDate: todayIso,
                          })
                        }
                        className="px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
                      >
                        Pull to Today
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTask({
                            ...task,
                            scheduledBucket: "later",
                            dueDate: getTodayIsoDate(4),
                          })
                        }
                        className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
                      >
                        Later
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {laterPlan.length > 0 && (
            <div className="pt-3 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <span>{laterPlan.length} additional item(s) parked for later this week</span>
              <button
                type="button"
                onClick={() => {
                  const first = laterPlan[0];
                  if (first) {
                    onUpdateTask({ ...first, scheduledBucket: "tomorrow", dueDate: tomorrowIso });
                  }
                }}
                className="text-teal-800 hover:underline font-medium whitespace-nowrap shrink-0"
              >
                Move next into Tomorrow
              </button>
            </div>
          )}
        </section>

        {/* Completed Today & Quick Starter Context */}
        <section
          aria-labelledby="completed-today-heading"
          className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <h2 id="completed-today-heading" className="text-base font-semibold text-slate-900">
                Completed Today
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {completedToday.length} finished
              </span>
            </div>

            {completedToday.length === 0 ? (
              <p className="text-sm text-slate-600 py-2">
                Completed actions will be logged here so you have a clear record of progress without streaks or pressure.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {completedToday.map((task) => (
                  <li key={task.id} className="py-2.5 flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700 line-through">{task.title}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateTask({
                          ...task,
                          completed: false,
                          completedAt: null,
                        })
                      }
                      className="text-xs text-slate-500 hover:text-slate-800 whitespace-nowrap shrink-0"
                    >
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {opportunities.some(
            (o) => o.id === "opp-starter-rethinkbh-bdr"
          ) && (
            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                Starter focus: Business Development Representative — RethinkBH
              </span>
              <button
                type="button"
                onClick={() =>
                  onNavigate("opportunities", "opp-starter-rethinkbh-bdr")
                }
                className="text-teal-800 font-semibold hover:underline whitespace-nowrap shrink-0"
              >
                Open RethinkBH Workspace →
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
