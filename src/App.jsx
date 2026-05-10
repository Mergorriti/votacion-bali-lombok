import { useEffect, useMemo, useState } from "react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { allPlans, ratingLabels, tripDays, voters, zones } from "./data/trip";

const voteValues = [1, 2, 3, 4];
// Este PIN solo oculta información para uso familiar, no es seguridad real.
const ORGANIZER_PIN = "2026";
const viewOptions = [
  { id: "home", label: "Inicio" },
  { id: "zone", label: "Planes por zona" },
  { id: "must", label: "Sí o sí" },
  { id: "ranking", label: "Ranking" },
  { id: "calendar", label: "Calendario propuesto" },
  { id: "booking", label: "Planes a reservar" },
  { id: "organizer", label: "Organizador" },
];
const joinPreferenceOptions = [
  "Solo si vamos todos",
  "Me apunto aunque vayamos pocos",
  "Lo haría incluso solo/a",
];
const bookingStatusOptions = ["Pendiente", "Reservado", "No reservar"];
const priorityScore = {
  imprescindible: 6,
  local: 5,
  aventura: 4,
  social: 3,
  relax: 2,
  opcional: 1,
};
const accommodationLinks = {
  "sanur-llegada": "https://www.booking.com/hotel/id/little-tree-house.html",
  sidemen: "https://www.booking.com/hotel/id/the-villa-sidemen.html",
  "kuta-lombok": "https://kanallaboutiquehotel.com/",
  "gerupuk-360": "https://www.booking.com/hotel/id/the-confidential-mandalika.html",
  senaru: "https://www.booking.com/hotel/id/villa-bambu-rinjani-lombok-utara1.html",
  "gili-air": "https://www.booking.com/hotel/id/star-bar-and-bungalows.html",
  "sanur-final": "https://tropical-bali-hotel.com/",
};

function getStoredVoter() {
  return window.localStorage.getItem("bali-voter") || voters[0];
}

function getStoredZone() {
  return window.localStorage.getItem("bali-zone") || zones[0].id;
}

function getStoredView() {
  return window.localStorage.getItem("bali-view") || "home";
}

function buildResults(votes, zoneId, planId) {
  const planVotes = votes.filter(
    (vote) => vote.day_id === zoneId && vote.plan_id === planId,
  );
  const mustDoVoters = planVotes
    .filter((vote) => Boolean(vote.must_do))
    .map((vote) => vote.voter);
  const total = planVotes.reduce((sum, vote) => sum + vote.rating, 0);
  const average = planVotes.length ? total / planVotes.length : 0;

  return {
    count: planVotes.length,
    total,
    average,
    mustDoVoters,
    mustDoCount: mustDoVoters.length,
    byVoter: Object.fromEntries(planVotes.map((vote) => [vote.voter, vote.rating])),
    mustDoByVoter: Object.fromEntries(planVotes.map((vote) => [vote.voter, Boolean(vote.must_do)])),
  };
}

function isStrongPlan(plan) {
  return (
    plan.effortLevel === "Fuerte" ||
    plan.duration === "día completo" ||
    (plan.duration === "medio día" && plan.priorityType === "aventura")
  );
}

function scorePlan(plan) {
  return (
    plan.results.mustDoCount * 35 +
    plan.results.total * 10 +
    plan.results.average * 3 +
    (plan.mustLevel === "Must absoluto" ? 18 : 0) +
    (plan.uniqueNote ? 5 : 0) +
    (plan.bookAhead ? 4 : 0) +
    (priorityScore[plan.priorityType] || 0)
  );
}

function sortPlans(plans) {
  return [...plans].sort((first, second) => scorePlan(second) - scorePlan(first));
}

function groupPlansByZone(plans) {
  return plans.reduce((groups, plan) => {
    groups[plan.zoneId] = groups[plan.zoneId] || [];
    groups[plan.zoneId].push(plan);
    return groups;
  }, {});
}

function getChoiceKey(voter, dayId, blockTime, mainPlanId) {
  return `${voter}-${dayId}-${blockTime}-${mainPlanId}`;
}

function App() {
  const [selectedVoter, setSelectedVoter] = useState(getStoredVoter);
  const [activeZoneId, setActiveZoneId] = useState(getStoredZone);
  const [activeView, setActiveView] = useState(getStoredView);
  const [votes, setVotes] = useState([]);
  const [calendarChoices, setCalendarChoices] = useState([]);
  const [planComments, setPlanComments] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [planPreferences, setPlanPreferences] = useState([]);
  const [bookingStatuses, setBookingStatuses] = useState([]);
  const [openAlternatives, setOpenAlternatives] = useState({});
  const [organizerPin, setOrganizerPin] = useState("");
  const [isOrganizerUnlocked, setIsOrganizerUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");

  const activeZone = useMemo(
    () => zones.find((zone) => zone.id === activeZoneId) || zones[0],
    [activeZoneId],
  );

  const enrichedPlans = useMemo(
    () =>
      allPlans.map((plan) => ({
        ...plan,
        results: buildResults(votes, plan.zoneId, plan.id),
      })),
    [votes],
  );
  const plansById = useMemo(
    () => Object.fromEntries(enrichedPlans.map((plan) => [plan.id, plan])),
    [enrichedPlans],
  );
  const calendarChoiceMap = useMemo(
    () =>
      Object.fromEntries(
        calendarChoices.map((choice) => [
          getChoiceKey(choice.voter, choice.day_id, choice.block_time, choice.main_plan_id),
          choice,
        ]),
      ),
    [calendarChoices],
  );
  const commentMap = useMemo(
    () =>
      Object.fromEntries(
        planComments.map((comment) => [
          `${comment.voter_name}-${comment.plan_id}`,
          comment.comment,
        ]),
      ),
    [planComments],
  );
  const preferenceMap = useMemo(
    () =>
      Object.fromEntries(
        planPreferences.map((preference) => [
          `${preference.voter_name}-${preference.plan_id}`,
          preference.join_preference,
        ]),
      ),
    [planPreferences],
  );
  const bookingStatusMap = useMemo(
    () =>
      Object.fromEntries(
        bookingStatuses.map((status) => [status.plan_id, status.status]),
      ),
    [bookingStatuses],
  );

  const zonePlans = useMemo(
    () => enrichedPlans.filter((plan) => plan.zoneId === activeZoneId),
    [activeZoneId, enrichedPlans],
  );

  const rankedZonePlans = useMemo(() => sortPlans(zonePlans), [zonePlans]);
  const rankedAllPlans = useMemo(() => sortPlans(enrichedPlans), [enrichedPlans]);
  const mustDoPlans = useMemo(
    () => rankedAllPlans.filter((plan) => plan.results.mustDoCount > 0),
    [rankedAllPlans],
  );
  const bookingPlans = useMemo(
    () => {
      const selectedAlternativeIds = new Set(
        calendarChoices
          .filter((choice) => choice.choice_type === "alternative" && choice.alternative_plan_id)
          .map((choice) => choice.alternative_plan_id),
      );
      return rankedAllPlans.filter(
        (plan) =>
          plan.bookAhead &&
          (plan.results.mustDoCount >= 2 ||
            plan.results.total >= 8 ||
            plan.results.average >= 3 ||
            selectedAlternativeIds.has(plan.id)),
      );
    },
    [calendarChoices, rankedAllPlans],
  );
  const calendar = useMemo(() => buildCalendar(rankedAllPlans), [rankedAllPlans]);

  useEffect(() => {
    window.localStorage.setItem("bali-voter", selectedVoter);
  }, [selectedVoter]);

  useEffect(() => {
    window.localStorage.setItem("bali-zone", activeZoneId);
  }, [activeZoneId]);

  useEffect(() => {
    window.localStorage.setItem("bali-view", activeView);
  }, [activeView]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setLoading(false);
      setMessage("Falta conectar Supabase. Revisa el archivo .env.local.");
      return;
    }

    let ignore = false;

    async function loadVotes({ showLoading = false } = {}) {
      const { data, error } = await supabase
        .from("trip_votes")
        .select("*")
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (error) {
        setMessage("No se pudieron cargar los votos. Revisa Supabase.");
      } else {
        setVotes(data || []);
        setMessage("");
      }
    }

    async function loadCalendarChoices() {
      const { data, error } = await supabase
        .from("calendar_choices")
        .select("*")
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (!error) {
        setCalendarChoices(data || []);
      }
    }

    async function loadPlanComments() {
      const { data, error } = await supabase
        .from("plan_comments")
        .select("*")
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (!error) {
        setPlanComments(data || []);
      }
    }

    async function loadPlanPreferences() {
      const { data, error } = await supabase
        .from("plan_preferences")
        .select("*")
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (!error) {
        setPlanPreferences(data || []);
      }
    }

    async function loadBookingStatuses() {
      const { data, error } = await supabase
        .from("booking_status")
        .select("*")
        .order("updated_at", { ascending: false });

      if (ignore) return;

      if (!error) {
        setBookingStatuses(data || []);
      }
    }

    async function loadInitialData() {
      setLoading(true);
      await Promise.all([
        loadVotes(),
        loadCalendarChoices(),
        loadPlanComments(),
        loadPlanPreferences(),
        loadBookingStatuses(),
      ]);
      if (!ignore) {
        setLoading(false);
      }
    }

    loadInitialData();

    const votesChannel = supabase
      .channel("trip_votes_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_votes" },
        loadVotes,
      )
      .subscribe();
    const choicesChannel = supabase
      .channel("calendar_choices_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_choices" },
        loadCalendarChoices,
      )
      .subscribe();
    const commentsChannel = supabase
      .channel("plan_comments_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_comments" },
        loadPlanComments,
      )
      .subscribe();
    const preferencesChannel = supabase
      .channel("plan_preferences_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_preferences" },
        loadPlanPreferences,
      )
      .subscribe();
    const bookingChannel = supabase
      .channel("booking_status_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "booking_status" },
        loadBookingStatuses,
      )
      .subscribe();

    return () => {
      ignore = true;
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(choicesChannel);
      supabase.removeChannel(commentsChannel);
      supabase.removeChannel(preferencesChannel);
      supabase.removeChannel(bookingChannel);
    };
  }, []);

  async function saveVote(zoneId, planId, rating) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de votar.");
      return;
    }

    const existingVote = getOwnVote(zoneId, planId);
    const voteKey = `${selectedVoter}-${zoneId}-${planId}`;
    const scrollPosition = window.scrollY;
    setSavingKey(voteKey);
    setMessage("");

    const nextVote = {
      voter: selectedVoter,
      day_id: zoneId,
      plan_id: planId,
      rating,
      must_do: Boolean(existingVote?.must_do),
    };

    setVotes((currentVotes) => {
      const withoutOldVote = currentVotes.filter(
        (vote) =>
          !(
            vote.voter === selectedVoter &&
            vote.day_id === zoneId &&
            vote.plan_id === planId
          ),
      );
      return [{ ...nextVote, updated_at: new Date().toISOString() }, ...withoutOldVote];
    });

    const { error } = await supabase
      .from("trip_votes")
      .upsert(nextVote, { onConflict: "voter,day_id,plan_id" });

    if (error) {
      setMessage("El voto no se guardó. Prueba otra vez.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  async function toggleMustDo(zoneId, planId) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de marcar sí o sí.");
      return;
    }

    const existingVote = getOwnVote(zoneId, planId);
    const nextMustDo = !Boolean(existingVote?.must_do);
    const voteKey = `${selectedVoter}-${zoneId}-${planId}-must`;
    const scrollPosition = window.scrollY;
    setSavingKey(voteKey);
    setMessage("");

    const nextVote = {
      voter: selectedVoter,
      day_id: zoneId,
      plan_id: planId,
      rating: existingVote?.rating || 3,
      must_do: nextMustDo,
    };

    setVotes((currentVotes) => {
      const withoutOldVote = currentVotes.filter(
        (vote) =>
          !(
            vote.voter === selectedVoter &&
            vote.day_id === zoneId &&
            vote.plan_id === planId
          ),
      );
      return [{ ...nextVote, updated_at: new Date().toISOString() }, ...withoutOldVote];
    });

    const { error } = await supabase
      .from("trip_votes")
      .upsert(nextVote, { onConflict: "voter,day_id,plan_id" });

    if (error) {
      setMessage("No se pudo guardar el sí o sí. Revisa Supabase.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  async function saveCalendarChoice(dayId, blockTime, mainPlanId, voter, choiceType, alternativePlanId = null) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de guardar alternativas.");
      return;
    }

    const choiceKey = getChoiceKey(voter, dayId, blockTime, mainPlanId);
    const scrollPosition = window.scrollY;
    setSavingKey(choiceKey);
    setMessage("");

    const nextChoice = {
      voter,
      day_id: dayId,
      block_time: blockTime,
      main_plan_id: mainPlanId,
      choice_type: choiceType,
      alternative_plan_id: choiceType === "alternative" ? alternativePlanId : null,
    };

    setCalendarChoices((currentChoices) => {
      const withoutOldChoice = currentChoices.filter(
        (choice) =>
          getChoiceKey(choice.voter, choice.day_id, choice.block_time, choice.main_plan_id) !==
          choiceKey,
      );
      return [{ ...nextChoice, updated_at: new Date().toISOString() }, ...withoutOldChoice];
    });

    const { error } = await supabase
      .from("calendar_choices")
      .upsert(nextChoice, { onConflict: "voter,day_id,block_time,main_plan_id" });

    if (error) {
      setMessage("No se pudo guardar la alternativa. Revisa Supabase.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  async function savePlanComment(planId, voterName) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de guardar comentarios.");
      return;
    }

    const commentKey = `${voterName}-${planId}`;
    const comment = (commentDrafts[commentKey] ?? commentMap[commentKey] ?? "").trim();
    const scrollPosition = window.scrollY;
    setSavingKey(commentKey);
    setMessage("");

    const nextComment = {
      plan_id: planId,
      voter_name: voterName,
      comment,
    };

    setPlanComments((currentComments) => {
      const withoutOldComment = currentComments.filter(
        (item) => !(item.plan_id === planId && item.voter_name === voterName),
      );
      return comment
        ? [{ ...nextComment, updated_at: new Date().toISOString() }, ...withoutOldComment]
        : withoutOldComment;
    });

    const { error } = await supabase
      .from("plan_comments")
      .upsert(nextComment, { onConflict: "plan_id,voter_name" });

    if (error) {
      setMessage("No se pudo guardar el comentario. Revisa Supabase.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  async function savePlanPreference(planId, voterName, joinPreference) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de guardar preferencias.");
      return;
    }

    const preferenceKey = `${voterName}-${planId}-preference`;
    const scrollPosition = window.scrollY;
    setSavingKey(preferenceKey);
    setMessage("");

    const nextPreference = {
      plan_id: planId,
      voter_name: voterName,
      join_preference: joinPreference,
    };

    setPlanPreferences((currentPreferences) => {
      const withoutOldPreference = currentPreferences.filter(
        (item) => !(item.plan_id === planId && item.voter_name === voterName),
      );
      return [{ ...nextPreference, updated_at: new Date().toISOString() }, ...withoutOldPreference];
    });

    const { error } = await supabase
      .from("plan_preferences")
      .upsert(nextPreference, { onConflict: "plan_id,voter_name" });

    if (error) {
      setMessage("No se pudo guardar la preferencia. Revisa Supabase.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  async function saveBookingStatus(planId, status) {
    if (!hasSupabaseConfig) {
      setMessage("Conecta Supabase antes de guardar reservas.");
      return;
    }

    const bookingKey = `${planId}-booking`;
    const scrollPosition = window.scrollY;
    setSavingKey(bookingKey);
    setMessage("");

    const nextStatus = { plan_id: planId, status };

    setBookingStatuses((currentStatuses) => {
      const withoutOldStatus = currentStatuses.filter((item) => item.plan_id !== planId);
      return [{ ...nextStatus, updated_at: new Date().toISOString() }, ...withoutOldStatus];
    });

    const { error } = await supabase
      .from("booking_status")
      .upsert(nextStatus, { onConflict: "plan_id" });

    if (error) {
      setMessage("No se pudo guardar el estado de reserva. Revisa Supabase.");
    }

    setSavingKey("");
    requestAnimationFrame(() => window.scrollTo({ top: scrollPosition }));
  }

  function getOwnVote(zoneId, planId) {
    return votes.find(
      (vote) =>
        vote.voter === selectedVoter &&
        vote.day_id === zoneId &&
        vote.plan_id === planId,
    );
  }

  function renderPlanCard(plan) {
    const ownVote = getOwnVote(plan.zoneId, plan.id);
    const voteKey = `${selectedVoter}-${plan.zoneId}-${plan.id}`;
    const mustDoKey = `${voteKey}-must`;
    const isMustDo = Boolean(ownVote?.must_do);
    const commentKey = `${selectedVoter}-${plan.id}`;
    const currentComment = commentDrafts[commentKey] ?? commentMap[commentKey] ?? "";
    const currentPreference = preferenceMap[`${selectedVoter}-${plan.id}`] || "";
    const visibleComments = voters
      .map((voter) => ({ voter, comment: commentMap[`${voter}-${plan.id}`] }))
      .filter((item) => item.comment);

    return (
      <article className="plan-card" key={`${plan.zoneId}-${plan.id}`}>
        <div className="plan-topline">
          <div>
            <div className="tag-row">
              <span className="moment-tag">{plan.bestMoment}</span>
              <span className="moment-tag muted">{plan.duration}</span>
              <span className="moment-tag muted">{plan.priorityType}</span>
              <span className="moment-tag effort">{plan.effortLevel}</span>
              {plan.mustLevel === "Must absoluto" ? (
                <span className="moment-tag must">Must</span>
              ) : null}
              {plan.bookAhead ? <span className="moment-tag reserve">Reservar</span> : null}
              {plan.results.mustDoCount >= 2 ? (
                <span className="moment-tag must">Intentar encajar sí o sí</span>
              ) : null}
            </div>
            <h3>{plan.title}</h3>
            <p>{plan.description}</p>
            <p className="vibe-line">{plan.vibe}</p>
            <p className="combine-line">Combina con: {plan.canCombineWith.join(", ")}</p>
            {plan.mustLevel || plan.uniqueNote || plan.travelerOpinion ? (
              <div className="plan-insight">
                <strong>Cómo valorar este plan</strong>
                {plan.mustLevel ? <p>Must: {plan.mustLevel}</p> : null}
                {plan.uniqueNote ? <p>¿Es único?: {plan.uniqueNote}</p> : null}
                {plan.travelerOpinion ? (
                  <p>Opinión de viajeros: {plan.travelerOpinion}</p>
                ) : null}
              </div>
            ) : null}
            {plan.similarNote ? (
              <div className="similar-note">
                <strong>También puedes hacerlo en otro momento</strong>
                <p>{plan.similarNote}</p>
              </div>
            ) : null}
            {plan.authenticityLevel ? (
              <div className="authenticity-note">
                <strong>Autenticidad</strong>
                <p>{plan.authenticityLevel}</p>
              </div>
            ) : null}
            {plan.backupPlan ? (
              <div className="backup-note">
                <strong>Plan B si estamos cansados</strong>
                <p>{plan.backupPlan}</p>
              </div>
            ) : null}
          </div>
          <a href={plan.link} target="_blank" rel="noreferrer">
            Ver plan
          </a>
        </div>

        <div className="vote-row" aria-label={`Votar ${plan.title}`}>
          {voteValues.map((value) => (
            <button
              className={ownVote?.rating === value ? "score active" : "score"}
              disabled={savingKey === voteKey}
              key={value}
              onClick={() => saveVote(plan.zoneId, plan.id, value)}
              title={ratingLabels[value]}
              type="button"
            >
              <span>{value}</span>
              <small>{ratingLabels[value]}</small>
            </button>
          ))}
        </div>

        <button
          className={isMustDo ? "must-do-button active" : "must-do-button"}
          disabled={savingKey === mustDoKey}
          onClick={() => toggleMustDo(plan.zoneId, plan.id)}
          type="button"
        >
          {isMustDo ? "Sí o sí para mí" : "Lo quiero hacer sí o sí"}
        </button>

        <div className="plan-extra-controls">
          <label>
            <span>Comentario opcional</span>
            <textarea
              onChange={(event) =>
                setCommentDrafts((currentDrafts) => ({
                  ...currentDrafts,
                  [commentKey]: event.target.value,
                }))
              }
              placeholder="Comentario opcional"
              value={currentComment}
            />
          </label>
          <button
            className="secondary-action"
            disabled={savingKey === commentKey}
            onClick={() => savePlanComment(plan.id, selectedVoter)}
            type="button"
          >
            Guardar comentario
          </button>
          <label>
            <span>Si no va todo el grupo</span>
            <select
              onChange={(event) =>
                savePlanPreference(plan.id, selectedVoter, event.target.value)
              }
              value={currentPreference}
            >
              <option value="" disabled>
                Elige una opción
              </option>
              {joinPreferenceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visibleComments.length ? (
          <div className="comment-list">
            {visibleComments.map((item) => (
              <p key={`${plan.id}-${item.voter}`}>
                <strong>{item.voter}:</strong> {item.comment}
              </p>
            ))}
          </div>
        ) : null}

        <div className="result-strip">
          <strong>{plan.results.total} puntos</strong>
          <span>
            {plan.results.count} de {voters.length} votos
          </span>
          <span>Media {plan.results.average.toFixed(1)}</span>
          <span>Sí o sí: {plan.results.mustDoCount}</span>
        </div>

        <div className="voter-results">
          {voters.map((voter) => (
            <span key={voter}>
              {voter}:{" "}
              <strong>
                {plan.results.byVoter[voter] || "-"}
                {plan.results.mustDoByVoter[voter] ? " · sí" : ""}
              </strong>
            </span>
          ))}
        </div>
      </article>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Bali, Lombok y Gili Air</p>
          <h1>Votación del viaje Bali · Lombok · Gili Air</h1>
          <p className="hero-copy">
            Primero votamos qué planes nos apetecen por zona. No hace falta decidir
            el día exacto ahora. Después la app propone un calendario realista,
            detecta qué planes hay que reservar y permite que cada persona elija
            alternativas si no quiere hacer el plan principal.
          </p>
        </div>
      </section>

      <nav className="top-tabs" aria-label="Navegación principal">
        {viewOptions.map((view) => (
          <button
            className={view.id === activeView ? "top-tab active" : "top-tab"}
            key={view.id}
            onClick={() => setActiveView(view.id)}
            type="button"
          >
            {view.label}
          </button>
        ))}
      </nav>

      <section className="control-panel" aria-label="Selector de votante">
        <p className="section-label">Quién está votando</p>
        <div className="voter-grid">
          {voters.map((voter) => (
            <button
              className={voter === selectedVoter ? "voter active" : "voter"}
              key={voter}
              onClick={() => setSelectedVoter(voter)}
              type="button"
            >
              {voter}
            </button>
          ))}
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      {activeView === "home" ? (
        <HomePanel onStart={() => setActiveView("zone")} />
      ) : null}

      {activeView === "zone" ? (
        <>
          <nav className="day-tabs" aria-label="Zonas del viaje">
            {zones.map((zone) => (
              <button
                className={zone.id === activeZoneId ? "day-tab active" : "day-tab"}
                key={zone.id}
                onClick={() => setActiveZoneId(zone.id)}
                type="button"
              >
                <span>{zone.subtitle}</span>
                <strong>{zone.title}</strong>
              </button>
            ))}
          </nav>

          <section className="day-header">
            <div>
              <p className="section-label">Planes por zona</p>
              <h2>{activeZone.title}</h2>
            </div>
            <p>{activeZone.subtitle}</p>
          </section>

          {loading ? (
            <div className="loading">Cargando votos...</div>
          ) : (
            <>
              <section className="plans">{zonePlans.map(renderPlanCard)}</section>
              <RankingPanel title="Planes más votados" plans={rankedZonePlans.slice(0, 5)} />
            </>
          )}
        </>
      ) : null}

      {activeView === "must" ? (
        <>
          <section className="day-header">
            <div>
              <p className="section-label">Sí o sí</p>
              <h2>Planes que cada uno quiere hacer sí o sí</h2>
            </div>
            <p>Marca tus imprescindibles personales. También puedes votar del 1 al 4.</p>
          </section>
          <section className="plans">{enrichedPlans.map(renderPlanCard)}</section>
          <MustDoPanel plans={mustDoPlans} />
        </>
      ) : null}

      {activeView === "ranking" ? (
        <>
          <RankingPanel
            label="Ranking general"
            title="Planes más votados de todo el viaje"
            plans={rankedAllPlans}
            showZone
          />
          <MustDoPanel plans={mustDoPlans} />
          <PeoplePanel plans={enrichedPlans} />
          <DividedOpinionsPanel plans={enrichedPlans} />
          <GroupPlansPanel plans={rankedAllPlans} />
        </>
      ) : null}

      {activeView === "calendar" ? (
        <CalendarPanel
          calendar={calendar}
          choices={calendarChoiceMap}
          openAlternatives={openAlternatives}
          plans={rankedAllPlans}
          plansById={plansById}
          savingKey={savingKey}
          onChoose={saveCalendarChoice}
          onToggleAlternatives={(key) =>
            setOpenAlternatives((current) => ({ ...current, [key]: !current[key] }))
          }
        />
      ) : null}

      {activeView === "booking" ? (
        <BookingPanel plans={bookingPlans} />
      ) : null}

      {activeView === "organizer" ? (
        <OrganizerPanel
          bookingStatusMap={bookingStatusMap}
          commentMap={commentMap}
          isUnlocked={isOrganizerUnlocked}
          onPinChange={setOrganizerPin}
          onStatusChange={saveBookingStatus}
          onUnlock={() => setIsOrganizerUnlocked(organizerPin === ORGANIZER_PIN)}
          pin={organizerPin}
          plans={bookingPlans}
          preferenceMap={preferenceMap}
          savingKey={savingKey}
        />
      ) : null}
    </main>
  );
}

function HomePanel({ onStart }) {
  return (
    <section className="home-panel">
      <p>
        Primero votamos qué planes nos apetecen por zona. No hace falta decidir el
        día exacto ahora. Después la app propone un calendario realista, detecta
        qué planes hay que reservar y permite que cada persona elija alternativas
        si no quiere hacer el plan principal.
      </p>
      <div className="steps-grid">
        <article>
          <span>1</span>
          <h3>Explora planes por zona</h3>
          <p>Sanur, Sidemen, Kuta Lombok, Gerupuk, Senaru, Gili Air y Sanur final.</p>
        </article>
        <article>
          <span>2</span>
          <h3>Mira el link de cada plan</h3>
          <p>Abre fotos o información antes de decidir si te apetece.</p>
        </article>
        <article>
          <span>3</span>
          <h3>Vota del 1 al 4</h3>
          <p>Pon una nota según cuánto te apetece.</p>
          <div className="scale-list">
            <strong>1 = No me apetece</strong>
            <strong>2 = Me da igual</strong>
            <strong>3 = Me gusta</strong>
            <strong>4 = Muy top</strong>
          </div>
        </article>
        <article>
          <span>4</span>
          <h3>Marca “Sí o sí”</h3>
          <p>Úsalo si no quieres perderte algo del viaje.</p>
        </article>
        <article>
          <span>5</span>
          <h3>Añade comentario</h3>
          <p>Deja una nota corta si tienes dudas, condiciones o muchas ganas.</p>
        </article>
        <article>
          <span>6</span>
          <h3>Indica si irías aunque no vaya todo el grupo</h3>
          <p>Así se ven planes para dividir grupo sin drama.</p>
        </article>
          <article>
            <span>7</span>
            <h3>Mira ranking, calendario y reservas</h3>
            <p>La app ordena lo más votado y ayuda a encajarlo en días reales.</p>
          </article>
      </div>
      <p className="authenticity-help">
        La etiqueta de autenticidad no significa que un plan sea mejor o peor. Sirve
        para distinguir entre planes locales, planes famosos que merecen la pena y
        planes más turísticos o de descanso.
      </p>
      <button className="start-button" onClick={onStart} type="button">
        Empezar a votar
      </button>
    </section>
  );
}

function RankingPanel({
  label = "Resultados",
  title,
  plans,
  showZone = false,
  showBookingPriority = false,
  emptyText = "Todavía no hay votos suficientes.",
}) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">{label}</p>
        <h2>{title}</h2>
      </div>
      <div className="ranking">
        {plans.length ? (
          plans.map((plan, index) => (
            <div className="rank-item" key={`${plan.zoneId}-${plan.id}`}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>
                  {plan.title}
                  {plan.mustLevel === "Must absoluto" ? " · Must" : ""}
                </strong>
                <p>
                  {showZone ? `${plan.zoneTitle} · ` : ""}
                  {plan.results.total} puntos · media {plan.results.average.toFixed(1)}
                  {showBookingPriority &&
                  plan.bookAhead &&
                  plan.mustLevel === "Must absoluto"
                    ? " · Reservar prioritario"
                    : plan.bookAhead
                      ? " · Reservar"
                      : ""}
                  {plan.results.mustDoCount >= 2 ? " · Intentar encajar sí o sí" : ""}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="empty-text">{emptyText}</p>
        )}
      </div>
    </section>
  );
}

function MustDoPanel({ plans }) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Planes más deseados sí o sí</p>
        <h2>Imprescindibles personales</h2>
      </div>
      <div className="ranking">
        {plans.length ? (
          plans.map((plan, index) => (
            <div className="rank-item" key={`must-${plan.zoneId}-${plan.id}`}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>{plan.title}</strong>
                <p>
                  {plan.zoneTitle} · {plan.results.mustDoCount} personas ·{" "}
                  {plan.results.mustDoVoters.join(", ")}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="empty-text">Todavía nadie ha marcado planes sí o sí.</p>
        )}
      </div>
    </section>
  );
}

function PeoplePanel({ plans }) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Planes más votados por cada persona</p>
        <h2>Favoritos individuales</h2>
      </div>
      <div className="people-grid">
        {voters.map((voter) => {
          const favorites = plans
            .filter((plan) => plan.results.byVoter[voter])
            .sort(
              (first, second) =>
                Number(second.results.mustDoByVoter[voter]) -
                  Number(first.results.mustDoByVoter[voter]) ||
                second.results.byVoter[voter] - first.results.byVoter[voter] ||
                scorePlan(second) - scorePlan(first),
            )
            .filter(
              (plan) =>
                plan.results.mustDoByVoter[voter] || plan.results.byVoter[voter] >= 3,
            )
            .slice(0, 5);

          return (
            <div className="person-box" key={voter}>
              <h3>{voter}</h3>
              {favorites.length ? (
                favorites.map((plan) => (
                  <p key={`${voter}-${plan.id}`}>
                    <strong>{plan.results.byVoter[voter]}</strong> · {plan.title}
                    {plan.results.mustDoByVoter[voter] ? " · sí o sí" : ""}
                  </p>
                ))
              ) : (
                <p>Sin votos todavía.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DividedOpinionsPanel({ plans }) {
  const dividedPlans = plans.filter((plan) => {
    const ratings = Object.entries(plan.results.byVoter);
    return ratings.some(([, rating]) => rating === 4) && ratings.some(([, rating]) => rating <= 2);
  });

  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Planes con opiniones divididas</p>
        <h2>Buenos candidatos para dividir grupo</h2>
      </div>
      <div className="split-list">
        {dividedPlans.length ? (
          dividedPlans.map((plan) => {
            const fans = voters.filter((voter) => plan.results.byVoter[voter] === 4);
            const unsure = voters.filter((voter) => plan.results.byVoter[voter] <= 2);

            return (
              <article className="split-item" key={`split-${plan.id}`}>
                <strong>{plan.title}</strong>
                <p>Muy top: {fans.join(", ")}</p>
                <p>No lo ve claro: {unsure.join(", ")}</p>
                <p>Puede ser buen plan para dividir grupo o proponer alternativa.</p>
              </article>
            );
          })
        ) : (
          <p className="empty-text">Todavía no hay planes con opiniones muy divididas.</p>
        )}
      </div>
    </section>
  );
}

function GroupPlansPanel({ plans }) {
  const groupPlans = plans.filter(
    (plan) => plan.results.mustDoCount >= 2 && plan.results.average >= 3,
  );

  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Planes que el grupo quiere hacer juntos</p>
        <h2>Momentos para compartir</h2>
      </div>
      <div className="ranking">
        {groupPlans.length ? (
          groupPlans.slice(0, 8).map((plan, index) => (
            <div className="rank-item" key={`group-${plan.id}`}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>{plan.title}</strong>
                <p>
                  {plan.zoneTitle} · {plan.results.mustDoCount} sí o sí · media{" "}
                  {plan.results.average.toFixed(1)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="empty-text">
            Todavía no hay planes con suficientes sí o sí y nota alta.
          </p>
        )}
      </div>
    </section>
  );
}

function BookingPanel({ bookingStatusMap = {}, onStatusChange = null, plans, savingKey = "" }) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Planes a reservar</p>
        <h2>Checklist de reservas</h2>
      </div>
      <div className="booking-list">
        {plans.length ? (
          plans.map((plan) => {
            const status = bookingStatusMap[plan.id] || "Pendiente";
            const bookingKey = `${plan.id}-booking`;

            return (
              <article className="booking-row" key={`booking-${plan.id}`}>
                <div>
                  <strong>{plan.title}</strong>
                  <p>{plan.zoneTitle}</p>
                  <div className="tag-row">
                    {plan.mustLevel ? <span className="moment-tag must">{plan.mustLevel}</span> : null}
                    <span className="moment-tag effort">{plan.effortLevel}</span>
                    {plan.mustLevel === "Must absoluto" && plan.bookAhead ? (
                      <span className="moment-tag reserve">Reservar prioritario</span>
                    ) : null}
                  </div>
                </div>
                <a href={plan.link} target="_blank" rel="noreferrer">
                  Link
                </a>
                {onStatusChange ? (
                  <select
                    disabled={savingKey === bookingKey}
                    onChange={(event) => onStatusChange(plan.id, event.target.value)}
                    value={status}
                  >
                    {bookingStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className="empty-text">Todavía no hay planes reservables con votos altos.</p>
        )}
      </div>
    </section>
  );
}

function OrganizerPanel({
  bookingStatusMap,
  commentMap,
  isUnlocked,
  onPinChange,
  onStatusChange,
  onUnlock,
  pin,
  plans,
  preferenceMap,
  savingKey,
}) {
  if (!isUnlocked) {
    return (
      <section className="results-panel organizer-lock">
        <div className="results-heading">
          <p className="section-label">Organizador</p>
          <h2>Costes y presupuesto</h2>
          <p className="calendar-help">
            Introduce el PIN de organizador para ver costes, presupuesto y estado de reservas.
          </p>
        </div>
        <div className="organizer-login">
          <input
            inputMode="numeric"
            onChange={(event) => onPinChange(event.target.value)}
            placeholder="PIN"
            type="password"
            value={pin}
          />
          <button className="start-button" onClick={onUnlock} type="button">
            Entrar
          </button>
        </div>
      </section>
    );
  }

  const selectedPlans = plans.filter((plan) => bookingStatusMap[plan.id] !== "No reservar");
  const budget = buildBudgetSummary(selectedPlans);

  return (
    <>
      <section className="results-panel budget-panel">
        <div className="results-heading">
          <p className="section-label">Organizador</p>
          <h2>Resumen de presupuesto</h2>
          <p className="calendar-help">
            Presupuesto orientativo. Revisar precios reales antes de reservar.
          </p>
        </div>
        <div className="budget-grid">
          <div>
            <span>Total estimado</span>
            <strong>{budget.total} €</strong>
          </div>
          <div>
            <span>Media por persona</span>
            <strong>{budget.perPerson} €</strong>
          </div>
        </div>
        <div className="budget-columns">
          <div>
            <h3>Planes caros</h3>
            {budget.expensive.length ? (
              budget.expensive.map((plan) => <p key={`expensive-${plan.id}`}>{plan.title}</p>)
            ) : (
              <p>Sin planes caros en la selección.</p>
            )}
          </div>
          <div>
            <h3>Gratis o baratos</h3>
            {budget.lowCost.length ? (
              budget.lowCost.map((plan) => <p key={`low-${plan.id}`}>{plan.title}</p>)
            ) : (
              <p>Sin planes gratis o baratos en la selección.</p>
            )}
          </div>
        </div>
      </section>

      <section className="results-panel">
        <div className="results-heading">
          <p className="section-label">Planes a reservar</p>
          <h2>Checklist con costes</h2>
        </div>
        <div className="booking-list">
          {plans.length ? (
            plans.map((plan) => {
              const status = bookingStatusMap[plan.id] || "Pendiente";
              const bookingKey = `${plan.id}-booking`;
              const comments = voters
                .map((voter) => ({ voter, comment: commentMap[`${voter}-${plan.id}`] }))
                .filter((item) => item.comment);
              const independentVoters = voters.filter((voter) =>
                ["Me apunto aunque vayamos pocos", "Lo haría incluso solo/a"].includes(
                  preferenceMap[`${voter}-${plan.id}`],
                ),
              );

              return (
                <article className="booking-row organizer" key={`organizer-${plan.id}`}>
                  <div>
                    <strong>{plan.title}</strong>
                    <p>{plan.zoneTitle}</p>
                    <div className="tag-row">
                      {plan.mustLevel ? <span className="moment-tag must">{plan.mustLevel}</span> : null}
                      <span className="moment-tag cost">{plan.costLevel}</span>
                      <span className="moment-tag effort">{plan.effortLevel}</span>
                      <span className="moment-tag reserve">{plan.results.mustDoCount} sí o sí</span>
                    </div>
                    <p>Media: {plan.results.average.toFixed(1)}</p>
                    {comments.length ? (
                      <div className="organizer-notes">
                        <strong>Comentarios</strong>
                        {comments.map((item) => (
                          <p key={`organizer-comment-${plan.id}-${item.voter}`}>
                            {item.voter}: {item.comment}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <p>
                      Lo haría aunque no vaya todo el grupo:{" "}
                      {independentVoters.length ? independentVoters.join(", ") : "sin marcar"}
                    </p>
                  </div>
                  <a href={plan.link} target="_blank" rel="noreferrer">
                    Link
                  </a>
                  <select
                    disabled={savingKey === bookingKey}
                    onChange={(event) => onStatusChange(plan.id, event.target.value)}
                    value={status}
                  >
                    {bookingStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </article>
              );
            })
          ) : (
            <p className="empty-text">Todavía no hay planes reservables con votos altos.</p>
          )}
        </div>
      </section>
    </>
  );
}

function buildBudgetSummary(plans) {
  const costValues = { Gratis: 0, Barato: 10, Medio: 35, Caro: 80 };
  const total = plans.reduce((sum, plan) => sum + (costValues[plan.costLevel] || 0), 0);

  return {
    total,
    perPerson: Math.round(total / voters.length),
    expensive: plans.filter((plan) => plan.costLevel === "Caro"),
    lowCost: plans.filter((plan) => ["Gratis", "Barato"].includes(plan.costLevel)),
  };
}

function getDayLoad(day) {
  const strongCount = day.slots.filter((slot) => slot.plan.effortLevel === "Fuerte").length;
  const hasSoft = day.slots.some((slot) => slot.plan.effortLevel === "Suave");
  const isLoaded = (day.transfer && strongCount > 0) || strongCount >= 2;

  if (isLoaded) {
    return {
      label: "Día cargado",
      level: "loaded",
      warning:
        "Este día puede estar demasiado cargado; considera mover una actividad o elegir Plan B.",
    };
  }

  if (strongCount === 1 && hasSoft) {
    return { label: "Día equilibrado", level: "balanced", warning: "" };
  }

  if (strongCount === 1 || day.slots.some((slot) => slot.plan.effortLevel === "Medio")) {
    return { label: "Día equilibrado", level: "balanced", warning: "" };
  }

  return { label: "Día suave", level: "soft", warning: "" };
}

function CalendarPanel({
  calendar,
  choices,
  openAlternatives,
  plans,
  plansById,
  savingKey,
  onChoose,
  onToggleAlternatives,
}) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Calendario propuesto</p>
        <h2>Propuesta automática según votos</h2>
        <p className="calendar-help">
          El calendario propone un plan principal para cada bloque, pero no hace falta
          que todos hagan lo mismo. Cada persona puede apuntarse al plan principal o
          elegir una alternativa compatible.
        </p>
      </div>
      <div className="calendar-list">
        {calendar.map((day) => {
          const dayLoad = getDayLoad(day);

          return (
            <article className="calendar-day" key={day.id}>
              <div>
                <p className="section-label">{day.title}</p>
                <h3>{day.place}</h3>
                <p>{day.note}</p>
                <span className={`day-load ${dayLoad.level}`}>{dayLoad.label}</span>
                {dayLoad.warning ? <p className="day-warning">{dayLoad.warning}</p> : null}
              </div>
              <div className="calendar-slots">
                {day.slots.length ? (
                  day.slots.map((slot) => (
                    <CalendarSlot
                      choices={choices}
                      day={day}
                      key={`${day.id}-${slot.plan.id}`}
                      onChoose={onChoose}
                      onToggleAlternatives={onToggleAlternatives}
                      openAlternatives={openAlternatives}
                      plans={plans}
                      plansById={plansById}
                      savingKey={savingKey}
                      slot={slot}
                    />
                  ))
                ) : (
                  <p className="empty-text">Sin plan propuesto.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarSlot({
  choices,
  day,
  onChoose,
  onToggleAlternatives,
  openAlternatives,
  plans,
  plansById,
  savingKey,
  slot,
}) {
  const alternatives = getCompatibleAlternatives(slot.plan, plans);
  const attendees = [];
  const alternativeRows = [];

  voters.forEach((voter) => {
    const choiceKey = getChoiceKey(voter, day.id, slot.time, slot.plan.id);
    const choice = choices[choiceKey];

    if (!choice || choice.choice_type === "main") {
      attendees.push(voter);
      return;
    }

    const alternativePlan =
      alternatives.find((plan) => plan.id === choice.alternative_plan_id) ||
      plansById[choice.alternative_plan_id];

    alternativeRows.push({
      voter,
      plan: alternativePlan,
    });
  });

  return (
    <div
      className={slot.plan.results.mustDoCount >= 2 ? "slot must-slot" : "slot"}
      key={`${day.id}-${slot.plan.id}`}
    >
      <div className="tag-row">
        <span className="moment-tag group">Plan de grupo</span>
        <span className="moment-tag">{slot.time}</span>
        {slot.plan.bookAhead ? <span className="moment-tag reserve">Reservar</span> : null}
        {slot.plan.results.mustDoCount >= 2 ? (
          <span className="moment-tag must">Intentar encajar sí o sí</span>
        ) : null}
      </div>
      <strong>{slot.plan.title}</strong>
      <p>
        {slot.plan.results.total} puntos · {slot.plan.duration}
        {slot.plan.bookAhead ? " · Reservar" : ""}
      </p>

      <div className="attendance-panel">
        <h4>¿Quién se apunta?</h4>
        {voters.map((voter) => {
          const choiceKey = getChoiceKey(voter, day.id, slot.time, slot.plan.id);
          const choice = choices[choiceKey];
          const isAlternative = choice?.choice_type === "alternative";
          const shouldShowAlternatives = isAlternative || openAlternatives[choiceKey];

          return (
            <div className="participant-choice" key={choiceKey}>
              <div>
                <strong>{voter}</strong>
                {isAlternative ? (
                  <span className="moment-tag individual">Alternativa individual</span>
                ) : null}
                {isAlternative && choice.alternative_plan_id ? (
                  <p>
                    Alternativa:{" "}
                    {alternatives.find((plan) => plan.id === choice.alternative_plan_id)?.title ||
                      plansById[choice.alternative_plan_id]?.title ||
                      "pendiente"}
                  </p>
                ) : (
                  <p>Plan principal</p>
                )}
              </div>
              <div className="choice-actions">
                <button
                  className={!isAlternative ? "choice-button active" : "choice-button"}
                  disabled={savingKey === choiceKey}
                  onClick={() => onChoose(day.id, slot.time, slot.plan.id, voter, "main")}
                  type="button"
                >
                  Me apunto al plan principal
                </button>
                <button
                  className={isAlternative ? "choice-button active" : "choice-button"}
                  onClick={() => onToggleAlternatives(choiceKey)}
                  type="button"
                >
                  Prefiero alternativa
                </button>
              </div>
              {shouldShowAlternatives ? (
                <div className="alternatives-list">
                  {alternatives.map((alternative) => (
                    <button
                      className={
                        choice?.alternative_plan_id === alternative.id
                          ? "alternative-button active"
                          : "alternative-button"
                      }
                      disabled={savingKey === choiceKey}
                      key={alternative.id}
                      onClick={() =>
                        onChoose(
                          day.id,
                          slot.time,
                          slot.plan.id,
                          voter,
                          "alternative",
                          alternative.id,
                        )
                      }
                      type="button"
                    >
                      <span className="moment-tag muted">Plan compatible</span>
                      <strong>{alternative.title}</strong>
                      <small>
                        {alternative.bestMoment} · {alternative.duration}
                        {alternative.bookAhead ? " · Reservar" : ""}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="attendance-summary">
        <p>
          <strong>Se apuntan:</strong> {attendees.length ? attendees.join(", ") : "Nadie todavía"}
        </p>
        <p>
          <strong>Alternativas:</strong>{" "}
          {alternativeRows.length
            ? alternativeRows
                .map((row) => `${row.voter} → ${row.plan?.title || "alternativa pendiente"}`)
                .join(", ")
            : "Sin alternativas elegidas"}
        </p>
      </div>
    </div>
  );
}

function getCompatibleAlternatives(mainPlan, plans) {
  const sameZone = plans.filter(
    (plan) =>
      plan.zoneId === mainPlan.zoneId &&
      plan.id !== mainPlan.id &&
      (plan.bestMoment === mainPlan.bestMoment ||
        plan.bestMoment === "Flexible" ||
        mainPlan.bestMoment === "Flexible") &&
      (plan.duration === mainPlan.duration ||
        plan.duration === "1-2h" ||
        mainPlan.duration === "1-2h"),
  );

  const alternatives = sortPlans(sameZone).slice(0, 4);

  if (alternatives.length >= 3) {
    return alternatives;
  }

  return [
    ...alternatives,
    {
      id: `descanso-${mainPlan.zoneId}-${mainPlan.id}`,
      title: "Descanso / piscina / tiempo libre",
      description: "Plan tranquilo para quien no quiera hacer la actividad principal.",
      vibe: "relax, libre, descanso",
      link: accommodationLinks[mainPlan.zoneId] || mainPlan.link,
      zone: mainPlan.zone,
      zoneId: mainPlan.zoneId,
      zoneTitle: mainPlan.zoneTitle,
      bestMoment: "Flexible",
      duration: "1-2h",
      priorityType: "relax",
      effortLevel: "Suave",
      costLevel: "Gratis",
      bookAhead: false,
      canCombineWith: ["descanso", "piscina", "cena"],
      results: {
        total: 0,
        average: 0,
        count: 0,
        mustDoCount: 0,
        mustDoVoters: [],
        byVoter: {},
        mustDoByVoter: {},
      },
    },
  ];
}

function isDemandingSeaPlan(plan) {
  return plan.id === "gili-snorkel-privado" || plan.title.includes("Discover Scuba");
}

function buildCalendar(rankedPlans) {
  const usedPlanIds = new Set();
  const plansByZone = groupPlansByZone(rankedPlans);

  return tripDays.map((day, index) => {
    const dayPlans = [
      ...(plansByZone[day.zoneId] || []),
      ...(day.nextZoneId ? plansByZone[day.nextZoneId] || [] : []),
    ].filter((plan) => !usedPlanIds.has(plan.id));
    const nextDay = tripDays[index + 1];
    const slots = [];

    if (day.transfer) {
      const softTransferPlan =
        dayPlans.find(
          (plan) =>
            plan.results.mustDoCount >= 2 &&
            plan.effortLevel === "Suave" &&
            plan.id !== "telaga-waja-rafting-sidemen",
        ) ||
        dayPlans.find(
          (plan) =>
            plan.effortLevel === "Suave" &&
            ["Flexible", "Tarde", "Noche"].includes(plan.bestMoment),
        ) ||
        dayPlans.find((plan) => plan.effortLevel !== "Fuerte");

      if (softTransferPlan) {
        slots.push({ time: softTransferPlan.bestMoment, plan: softTransferPlan });
        usedPlanIds.add(softTransferPlan.id);
      }
      return { ...day, slots };
    }

    const dawn = dayPlans.find(
      (plan) =>
        !usedPlanIds.has(plan.id) &&
        plan.bestMoment === "Madrugada" &&
        !nextDay?.transfer,
    );
    if (dawn) {
      slots.push({ time: "Madrugada", plan: dawn });
      usedPlanIds.add(dawn.id);
    }

    const morning = dayPlans.find(
      (plan) =>
        !usedPlanIds.has(plan.id) &&
        plan.bestMoment === "Mañana" &&
        (isStrongPlan(plan) || plan.results.mustDoCount >= 2 || plan.mustLevel === "Must absoluto"),
    );
    if (morning) {
      slots.push({ time: "Mañana", plan: morning });
      usedPlanIds.add(morning.id);
    }

    const hasDemandingSeaPlan = slots.some((slot) => isDemandingSeaPlan(slot.plan));
    const afternoon = dayPlans.find(
      (plan) =>
        !usedPlanIds.has(plan.id) &&
        ["Tarde", "Flexible"].includes(plan.bestMoment) &&
        plan.effortLevel !== "Fuerte" &&
        !(hasDemandingSeaPlan && isDemandingSeaPlan(plan)),
    );
    if (afternoon) {
      slots.push({ time: "Tarde", plan: afternoon });
      usedPlanIds.add(afternoon.id);
    }

    const night = dayPlans.find(
      (plan) => !usedPlanIds.has(plan.id) && plan.bestMoment === "Noche",
    );
    if (night) {
      slots.push({ time: "Noche", plan: night });
      usedPlanIds.add(night.id);
    }

    return { ...day, slots };
  });
}

export default App;
