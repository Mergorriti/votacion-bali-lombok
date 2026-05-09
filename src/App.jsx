import { useEffect, useMemo, useState } from "react";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { allPlans, ratingLabels, tripDays, voters, zones } from "./data/trip";

const voteValues = [1, 2, 3, 4];
const viewOptions = [
  { id: "home", label: "Inicio" },
  { id: "zone", label: "Planes por zona" },
  { id: "must", label: "Sí o sí" },
  { id: "ranking", label: "Ranking" },
  { id: "calendar", label: "Calendario propuesto" },
  { id: "booking", label: "Planes a reservar" },
];
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
    plan.duration === "medio día" ||
    plan.duration === "día completo" ||
    ["imprescindible", "aventura"].includes(plan.priorityType)
  );
}

function scorePlan(plan) {
  return (
    plan.results.mustDoCount * 35 +
    plan.results.total * 10 +
    plan.results.average * 3 +
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
  const [openAlternatives, setOpenAlternatives] = useState({});
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

    async function loadInitialData() {
      setLoading(true);
      await Promise.all([loadVotes(), loadCalendarChoices()]);
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

    return () => {
      ignore = true;
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(choicesChannel);
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

    return (
      <article className="plan-card" key={`${plan.zoneId}-${plan.id}`}>
        <div className="plan-topline">
          <div>
            <div className="tag-row">
              <span className="moment-tag">{plan.bestMoment}</span>
              <span className="moment-tag muted">{plan.duration}</span>
              <span className="moment-tag muted">{plan.priorityType}</span>
              {plan.bookAhead ? <span className="moment-tag reserve">Reservar</span> : null}
              {plan.results.mustDoCount >= 2 ? (
                <span className="moment-tag must">Intentar encajar sí o sí</span>
              ) : null}
            </div>
            <h3>{plan.title}</h3>
            <p>{plan.description}</p>
            <p className="vibe-line">{plan.vibe}</p>
            <p className="combine-line">Combina con: {plan.canCombineWith.join(", ")}</p>
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
            Esta app sirve para elegir juntos los planes del viaje. No estamos
            votando un único plan por día, sino todos los planes que nos apetecen
            hacer en cada zona. Después, la app ordenará los planes más votados y
            propondrá cómo encajarlos en el calendario real.
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
        <RankingPanel
          label="Planes a reservar"
          title="Reservar si salen muy votados"
          plans={bookingPlans}
          emptyText="Todavía no hay planes reservables con votos altos."
          showZone
        />
      ) : null}
    </main>
  );
}

function HomePanel({ onStart }) {
  return (
    <section className="home-panel">
      <p>
        No hace falta decidir fechas exactas ahora. Primero votamos qué nos
        apetece; después organizamos los planes por días.
      </p>
      <div className="steps-grid">
        <article>
          <span>1</span>
          <h3>Explora los planes por zona</h3>
          <p>Sanur, Sidemen, Kuta Lombok, Gerupuk, Senaru, Gili Air y Sanur final.</p>
        </article>
        <article>
          <span>2</span>
          <h3>Vota cada plan</h3>
          <p>Pon una nota del 1 al 4 según cuánto te apetece.</p>
          <div className="scale-list">
            <strong>1 = No me apetece</strong>
            <strong>2 = Me da igual</strong>
            <strong>3 = Me gusta</strong>
            <strong>4 = Muy top</strong>
          </div>
        </article>
        <article>
          <span>3</span>
          <h3>La app propone el calendario</h3>
          <p>
            Los planes más votados se reparten según mañana, tarde o noche,
            evitando cargar demasiado los días de traslado.
          </p>
        </article>
      </div>
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
                <strong>{plan.title}</strong>
                <p>
                  {showZone ? `${plan.zoneTitle} · ` : ""}
                  {plan.results.total} puntos · media {plan.results.average.toFixed(1)}
                  {plan.bookAhead ? " · Reservar" : ""}
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
                second.results.byVoter[voter] - first.results.byVoter[voter] ||
                Number(second.results.mustDoByVoter[voter]) -
                  Number(first.results.mustDoByVoter[voter]) ||
                scorePlan(second) - scorePlan(first),
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
        {calendar.map((day) => (
          <article className="calendar-day" key={day.id}>
            <div>
              <p className="section-label">{day.title}</p>
              <h3>{day.place}</h3>
              <p>{day.note}</p>
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
        ))}
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
      const mustDoSoftPlan =
        dayPlans.find((plan) => plan.results.mustDoCount >= 2 && !isStrongPlan(plan)) ||
        dayPlans.find((plan) => plan.results.mustDoCount >= 2);
      const softPlan = mustDoSoftPlan || dayPlans.find((plan) => !isStrongPlan(plan)) || dayPlans[0];
      if (softPlan) {
        slots.push({ time: softPlan.bestMoment, plan: softPlan });
        usedPlanIds.add(softPlan.id);
      }
      return { ...day, slots };
    }

    const morning = dayPlans.find(
      (plan) => plan.bestMoment === "Mañana" && isStrongPlan(plan),
    );
    if (morning) {
      slots.push({ time: "Mañana", plan: morning });
      usedPlanIds.add(morning.id);
    }

    const afternoon = dayPlans.find(
      (plan) =>
        !usedPlanIds.has(plan.id) &&
        ["Tarde", "Flexible"].includes(plan.bestMoment) &&
        !isStrongPlan(plan),
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

    const dawn = dayPlans.find(
      (plan) =>
        !usedPlanIds.has(plan.id) &&
        plan.bestMoment === "Madrugada" &&
        !nextDay?.transfer,
    );
    if (dawn && slots.length < 3) {
      slots.unshift({ time: "Madrugada", plan: dawn });
      usedPlanIds.add(dawn.id);
    }

    return { ...day, slots };
  });
}

export default App;
