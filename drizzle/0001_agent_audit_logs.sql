CREATE TYPE "public"."audit_status" AS ENUM('INTERCEPTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "agent_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"response" jsonb,
	"status" "audit_status" DEFAULT 'INTERCEPTED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
