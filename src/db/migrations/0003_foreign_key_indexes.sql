CREATE INDEX "guest_sessions_claimed_by_idx" ON "guest_sessions" USING btree ("claimed_by_user_id");--> statement-breakpoint
CREATE INDEX "user_game_settings_hardware_profile_idx" ON "user_game_settings" USING btree ("hardware_profile_id");--> statement-breakpoint
CREATE INDEX "subjective_preferences_candidate_idx" ON "subjective_preferences" USING btree ("chosen_candidate_id");--> statement-breakpoint
CREATE INDEX "validation_runs_session_idx" ON "validation_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_user_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "research_consents_guest_session_idx" ON "research_consents" USING btree ("guest_session_id");--> statement-breakpoint
CREATE INDEX "telemetry_batches_round_idx" ON "telemetry_batches" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "telemetry_batches_consent_idx" ON "telemetry_batches" USING btree ("consent_id");