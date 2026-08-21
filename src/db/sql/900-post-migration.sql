-- Applied by scripts/migrate.ts after the generated Drizzle migrations.
-- Everything here is idempotent and safe to re-run.
--
-- It contains the three things Drizzle cannot express from the schema definition:
--   1. the immutability trigger on algorithm_versions (SENS-BR-029),
--   2. table and column comments, so the documentation lives in the database (doc 21 §21.5),
--   3. read-only support views for diagnosing a user report without a complex query.

-- ---------------------------------------------------------------------------
-- 1. Released algorithm parameter sets are immutable.
-- ---------------------------------------------------------------------------
-- A released set is what a stored recommendation points at in order to remain explainable
-- (SENS-BR-020). Editing one in place would silently change the meaning of every historical
-- result that references it. Corrections are new versions, never edits.
--
-- Only `deprecated_at` and `notes` may change: marking a version superseded, or annotating
-- it, does not alter what it computed.

CREATE OR REPLACE FUNCTION senslab_algorithm_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.version_label IS DISTINCT FROM OLD.version_label
     OR NEW.params IS DISTINCT FROM OLD.params
     OR NEW.params_hash IS DISTINCT FROM OLD.params_hash
     OR NEW.released_at IS DISTINCT FROM OLD.released_at
  THEN
    RAISE EXCEPTION
      'algorithm_versions rows are immutable once released (SENS-BR-029). '
      'Release a new version instead of editing %/%.', OLD.kind, OLD.version_label
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS algorithm_versions_immutable ON algorithm_versions;
CREATE TRIGGER algorithm_versions_immutable
  BEFORE UPDATE ON algorithm_versions
  FOR EACH ROW
  EXECUTE FUNCTION senslab_algorithm_versions_immutable();

-- Deletion is likewise forbidden: a recommendation that references a deleted version becomes
-- unexplainable, and the foreign key alone would only stop it while a reference still exists.
CREATE OR REPLACE FUNCTION senslab_algorithm_versions_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'algorithm_versions rows are never deleted (SENS-BR-020): results generated under %/% '
    'must remain explainable.', OLD.kind, OLD.version_label
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS algorithm_versions_no_delete ON algorithm_versions;
CREATE TRIGGER algorithm_versions_no_delete
  BEFORE DELETE ON algorithm_versions
  FOR EACH ROW
  EXECUTE FUNCTION senslab_algorithm_versions_no_delete();

-- ---------------------------------------------------------------------------
-- 2. Documentation in the database.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE users IS
  'Registered accounts. Credentials live in auth_identities so a password account and an '
  'OAuth account share one shape (ADR-022).';
COMMENT ON TABLE guest_sessions IS
  'Server-issued guest identity. The claim flow resolves this row from an HttpOnly cookie; a '
  'client-supplied session id is never accepted (SENS-SEC-018). Unclaimed rows expire after '
  '7 days (SENS-BR-003).';
COMMENT ON TABLE auth_sessions IS
  'Opaque server-side sessions. Only the HMAC of the token is stored (SENS-SEC-003).';
COMMENT ON TABLE hardware_profiles IS
  'Named hardware setups. DPI is the only required field (SENS-BR-004); dpi_source records '
  'how much we trust it (SENS-BR-005).';
COMMENT ON COLUMN hardware_profiles.windows_pointer_speed IS
  'Context for warnings and support only. Never used as a multiplier in any calculation '
  '(doc 11 §11.8).';
COMMENT ON TABLE games IS 'Supported games. Adding one touches no engine code (doc 12 §12.10).';
COMMENT ON TABLE game_versions IS
  'One row per build a sensitivity model was verified against. Verification is never '
  'permanent: a game patch reverts it to needs_recheck (doc 08 §8.6).';
COMMENT ON TABLE game_sensitivity_models IS
  'Per (game version, scope) conversion model. Verification is tracked at scope granularity '
  'because a patch can change one scope without touching the others.';
COMMENT ON TABLE algorithm_versions IS
  'Immutable released parameter sets. Insert-only, enforced by trigger (SENS-BR-029).';
COMMENT ON TABLE metric_definitions IS
  'The controlled metric vocabulary (doc 10). A metric not declared here cannot be stored.';
COMMENT ON TABLE test_sessions IS
  'A calibration run. Not to be confused with auth_sessions (doc 35).';
COMMENT ON COLUMN test_sessions.hardware_snapshot IS
  'Immutable copy of the hardware at creation. Editing a profile must never rewrite history '
  '(SENS-BR-035).';
COMMENT ON COLUMN test_sessions.seed IS
  'Drives every random draw in the session so the exact stimulus sequence is reproducible '
  '(SENS-BR-031).';
COMMENT ON TABLE calibration_rounds IS
  'Audit trail of the adaptive search: bracket, fit, drift, MDE and the decision taken. '
  'Without it a recommendation cannot be explained (FR-069).';
COMMENT ON TABLE test_rounds IS
  'One candidate x one aim test. (session_id, presentation_order) is unique, which is what '
  'makes round ingest idempotent (SENS-NFR-016).';
COMMENT ON COLUMN test_trials.invalid_reason IS
  'Always procedural. A trial is never invalidated for performing badly (SENS-BR-009).';
COMMENT ON TABLE trial_metrics IS
  'Narrow keyed metric storage (ADR-012). The composite PK is also the covering index for '
  'the only access pattern.';
COMMENT ON TABLE round_metrics IS
  'Round aggregates. The common read path uses these and never touches trial-level data.';
COMMENT ON TABLE recommendations IS
  'The result object. recommended_counts_360 is canonical; game settings are a regenerable '
  'cache (SENS-BR-025).';
COMMENT ON COLUMN recommendations.confidence_index IS
  'A bounded quality index, not a probability. Capped by the confidence model version '
  '(SENS-BR-028).';
COMMENT ON TABLE recommendation_game_settings IS
  'Converted settings. No row is ever written for an unverified model - the absence of a row '
  'IS the unverified state (SENS-BR-014).';
COMMENT ON TABLE validation_runs IS
  'Blind A/B of the original against the recommended sensitivity. The verdict must agree with '
  'the confidence interval, enforced by check constraint (SENS-BR-016).';
COMMENT ON TABLE subjective_preferences IS
  'What the player said felt best. Recorded, never used in any computation (SENS-BR-002).';
COMMENT ON TABLE telemetry_batches IS
  'Pointers to consented raw telemetry in object storage. No raw pointer samples are ever '
  'stored in PostgreSQL (SENS-BR-032).';
COMMENT ON TABLE research_consents IS
  'Explicit, revocable, versioned consent. A telemetry batch cannot exist without one.';

-- ---------------------------------------------------------------------------
-- 3. Read-only support views (doc 21 §21.5).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_session_overview AS
SELECT
  s.id                        AS session_id,
  s.status,
  s.mode,
  s.environment_class,
  s.started_at,
  s.completed_at,
  s.user_id,
  s.guest_session_id,
  g.slug                      AS game_slug,
  (s.hardware_snapshot ->> 'dpi')::int        AS dpi,
  s.hardware_snapshot ->> 'dpiSource'         AS dpi_source,
  (SELECT count(*) FROM test_rounds  r WHERE r.session_id = s.id) AS round_count,
  (SELECT count(*) FROM test_trials  t
     JOIN test_rounds r2 ON r2.id = t.round_id
    WHERE r2.session_id = s.id)                                    AS trial_count,
  (SELECT count(*) FROM session_quality_flags q WHERE q.session_id = s.id) AS quality_flag_count
FROM test_sessions s
LEFT JOIN game_versions gv ON gv.id = s.primary_game_version_id
LEFT JOIN games g          ON g.id = gv.game_id;

COMMENT ON VIEW v_session_overview IS
  'One flat row per calibration session, for support and diagnosis.';

CREATE OR REPLACE VIEW v_recommendation_summary AS
SELECT
  r.id                    AS recommendation_id,
  r.session_id,
  r.verdict,
  r.recommended_counts_360,
  r.recommended_cm_360,
  r.comfort_range_low_cm360,
  r.comfort_range_high_cm360,
  r.confidence_index,
  r.settings_reliability,
  r.aim_profile_key,
  r.created_at,
  sv.version_label        AS scoring_version,
  cv.version_label        AS calibration_version,
  fv.version_label        AS confidence_version
FROM recommendations r
JOIN algorithm_versions sv ON sv.id = r.scoring_version_id
JOIN algorithm_versions cv ON cv.id = r.calibration_version_id
JOIN algorithm_versions fv ON fv.id = r.confidence_version_id;

COMMENT ON VIEW v_recommendation_summary IS
  'Recommendations with their algorithm versions resolved to labels.';

CREATE OR REPLACE VIEW v_session_quality AS
SELECT
  s.id AS session_id,
  s.environment_class,
  (s.environment #>> '{pointerLock,unadjustedMovementEffective}')::boolean AS raw_input_effective,
  (s.environment #>> '{frameProbe,lateFrameRatio}')::double precision      AS probe_late_frame_ratio,
  (s.environment #>> '{estimatedRefreshHz}')::double precision             AS refresh_hz,
  (s.environment #>> '{browser,name}')                                      AS browser,
  (s.environment #>> '{os,family}')                                         AS os_family,
  array_agg(q.flag ORDER BY q.flag) FILTER (WHERE q.flag IS NOT NULL)       AS quality_flags
FROM test_sessions s
LEFT JOIN session_quality_flags q ON q.session_id = s.id
GROUP BY s.id;

COMMENT ON VIEW v_session_quality IS
  'Environment and quality flags per session. Feeds the quality dashboards and EV-010.';
