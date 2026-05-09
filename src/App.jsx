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

function App() {
  const [selectedVoter, setSelectedVoter] = useState(getStoredVoter);
  const [activeZoneId, setActiveZoneId] = useState(getStoredZone);
  const [activeView, setActiveView] = useState(getStoredView);
  const [votes, setVotes] = useState([]);
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
    () =>
      rankedAllPlans.filter(
        (plan) =>
          plan.bookAhead &&
          (plan.results.mustDoCount >= 2 || plan.results.total >= 8 || plan.results.average >= 3),
      ),
    [rankedAllPlans],
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
      if (showLoading) {
        setLoading(true);
      }
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

      if (showLoading) {
        setLoading(false);
      }
    }

    loadVotes({ showLoading: true });

    const channel = supabase
      .channel("trip_votes_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_votes" },
        loadVotes,
      )
      .subscribe();

    return () => {
      ignore = true;
      supabase.removeChannel(channel);
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

      {activeView === "calendar" ? <CalendarPanel calendar={calendar} /> : null}

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

function CalendarPanel({ calendar }) {
  return (
    <section className="results-panel">
      <div className="results-heading">
        <p className="section-label">Calendario propuesto</p>
        <h2>Propuesta automática según votos</h2>
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
                  <div
                    className={
                      slot.plan.results.mustDoCount >= 2 ? "slot must-slot" : "slot"
                    }
                    key={`${day.id}-${slot.plan.id}`}
                  >
                    <span>{slot.time}</span>
                    <strong>{slot.plan.title}</strong>
                    <p>
                      {slot.plan.results.total} puntos · {slot.plan.duration}
                      {slot.plan.bookAhead ? " · Reservar" : ""}
                      {slot.plan.results.mustDoCount >= 2
                        ? " · Intentar encajar sí o sí"
                        : ""}
                    </p>
                  </div>
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
