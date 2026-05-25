--
-- PostgreSQL database dump
--


-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    attendance_id integer NOT NULL,
    enrollment_id integer NOT NULL,
    schedule_id integer NOT NULL,
    student_id integer NOT NULL,
    status text NOT NULL,
    marked_by_user_id integer,
    marked_at timestamp with time zone DEFAULT now(),
    notes text,
    CONSTRAINT attendance_status_check CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'excused'::text])))
);


--
-- Name: attendance_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attendance_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attendance_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attendance_attendance_id_seq OWNED BY public.attendance.attendance_id;


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    branch_id integer NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    capacity_per_teacher integer DEFAULT 10 NOT NULL,
    deleted_at timestamp with time zone,
    low_credit_threshold integer DEFAULT 3 NOT NULL
);


--
-- Name: branches_branch_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branches_branch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branches_branch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branches_branch_id_seq OWNED BY public.branches.branch_id;


--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    complaint_id integer NOT NULL,
    parent_id integer NOT NULL,
    student_id integer,
    subject text NOT NULL,
    body text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    staff_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT complaints_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'reviewed'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: complaints_complaint_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.complaints_complaint_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: complaints_complaint_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.complaints_complaint_id_seq OWNED BY public.complaints.complaint_id;


--
-- Name: contract_school_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_school_payments (
    payment_id integer NOT NULL,
    contract_school_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    paid_at timestamp with time zone NOT NULL,
    notes text,
    recorded_by_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contract_school_payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_school_payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_school_payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_school_payments_payment_id_seq OWNED BY public.contract_school_payments.payment_id;


--
-- Name: contract_school_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_school_slots (
    slot_id integer NOT NULL,
    contract_school_id integer NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    duration_minutes integer NOT NULL,
    teacher_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT contract_school_slots_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: contract_school_slots_slot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_school_slots_slot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_school_slots_slot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_school_slots_slot_id_seq OWNED BY public.contract_school_slots.slot_id;


--
-- Name: contract_schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_schools (
    contract_school_id integer NOT NULL,
    branch_id integer NOT NULL,
    name text NOT NULL,
    address text,
    contact_name text,
    contact_phone text,
    deleted_at timestamp with time zone,
    contract_start_date date,
    contract_end_date date,
    sessions_per_week integer,
    session_duration_minutes integer,
    notes text
);


--
-- Name: contract_schools_contract_school_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_schools_contract_school_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_schools_contract_school_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_schools_contract_school_id_seq OWNED BY public.contract_schools.contract_school_id;


--
-- Name: contract_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_sessions (
    session_id integer NOT NULL,
    contract_id integer NOT NULL,
    schedule_id integer NOT NULL,
    scheduled_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT contract_sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'skipped'::text])))
);


--
-- Name: contract_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_sessions_session_id_seq OWNED BY public.contract_sessions.session_id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    contract_id integer NOT NULL,
    student_id integer NOT NULL,
    package_id integer NOT NULL,
    branch_id integer NOT NULL,
    start_date date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    CONSTRAINT contracts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text])))
);


--
-- Name: contracts_contract_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contracts_contract_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contracts_contract_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contracts_contract_id_seq OWNED BY public.contracts.contract_id;


--
-- Name: course_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_levels (
    level_id integer NOT NULL,
    branch_id integer NOT NULL,
    name text NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: course_levels_level_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_levels_level_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_levels_level_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_levels_level_id_seq OWNED BY public.course_levels.level_id;


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    course_id integer NOT NULL,
    branch_id integer NOT NULL,
    level_id integer,
    robot_type_id integer,
    name text NOT NULL,
    description text,
    deleted_at timestamp with time zone
);


--
-- Name: courses_course_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_course_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: courses_course_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_course_id_seq OWNED BY public.courses.course_id;


--
-- Name: customer_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_packages (
    customer_package_id integer NOT NULL,
    student_id integer NOT NULL,
    package_id integer NOT NULL,
    purchased_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: customer_packages_customer_package_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_packages_customer_package_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_packages_customer_package_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_packages_customer_package_id_seq OWNED BY public.customer_packages.customer_package_id;


--
-- Name: customer_warnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_warnings (
    warning_id integer NOT NULL,
    student_id integer NOT NULL,
    branch_id integer NOT NULL,
    classes_remaining integer NOT NULL,
    generated_date date DEFAULT CURRENT_DATE NOT NULL
);


--
-- Name: customer_warnings_warning_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_warnings_warning_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_warnings_warning_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_warnings_warning_id_seq OWNED BY public.customer_warnings.warning_id;


--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    token_id integer NOT NULL,
    user_id integer NOT NULL,
    fcm_token text NOT NULL,
    platform text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT device_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])))
);


--
-- Name: device_tokens_token_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.device_tokens_token_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: device_tokens_token_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.device_tokens_token_id_seq OWNED BY public.device_tokens.token_id;


--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    enrollment_id integer NOT NULL,
    student_id integer NOT NULL,
    schedule_id integer NOT NULL,
    customer_package_id integer,
    status text DEFAULT 'pending'::text NOT NULL,
    low_class_warning boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    booking_note text,
    CONSTRAINT enrollments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text])))
);


--
-- Name: enrollments_enrollment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enrollments_enrollment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enrollments_enrollment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enrollments_enrollment_id_seq OWNED BY public.enrollments.enrollment_id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    expense_id integer NOT NULL,
    branch_id integer NOT NULL,
    submitted_by_user_id integer NOT NULL,
    approved_by_user_id integer,
    amount numeric(12,2) NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    receipt_url text,
    status text DEFAULT 'pending'::text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now(),
    approved_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT expenses_category_check CHECK ((category = ANY (ARRAY['travel'::text, 'supplies'::text, 'other'::text]))),
    CONSTRAINT expenses_check CHECK (((submitted_by_user_id <> approved_by_user_id) OR (approved_by_user_id IS NULL))),
    CONSTRAINT expenses_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: expenses_expense_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expenses_expense_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expenses_expense_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expenses_expense_id_seq OWNED BY public.expenses.expense_id;


--
-- Name: holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.holidays (
    holiday_id integer NOT NULL,
    branch_id integer NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT holidays_dates_check CHECK ((end_date >= start_date))
);


--
-- Name: holidays_holiday_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.holidays_holiday_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: holidays_holiday_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.holidays_holiday_id_seq OWNED BY public.holidays.holiday_id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    message_id integer NOT NULL,
    parent_id integer NOT NULL,
    sender_role character varying(10) NOT NULL,
    sender_id integer NOT NULL,
    body text NOT NULL,
    request_id integer,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_sender_role_check CHECK (((sender_role)::text = ANY ((ARRAY['parent'::character varying, 'staff'::character varying])::text[])))
);


--
-- Name: messages_message_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_message_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_message_id_seq OWNED BY public.messages.message_id;


--
-- Name: notification_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_views (
    view_id integer NOT NULL,
    user_id integer NOT NULL,
    notification_type character varying(30) NOT NULL,
    notification_ref_id integer,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_views_view_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notification_views_view_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notification_views_view_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notification_views_view_id_seq OWNED BY public.notification_views.view_id;


--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_verifications (
    otp_id integer NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_verifications_otp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.otp_verifications_otp_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: otp_verifications_otp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.otp_verifications_otp_id_seq OWNED BY public.otp_verifications.otp_id;


--
-- Name: package_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_redemptions (
    redemption_id integer NOT NULL,
    customer_package_id integer NOT NULL,
    enrollment_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: package_redemptions_redemption_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.package_redemptions_redemption_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: package_redemptions_redemption_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.package_redemptions_redemption_id_seq OWNED BY public.package_redemptions.redemption_id;


--
-- Name: packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packages (
    package_id integer NOT NULL,
    course_id integer NOT NULL,
    name text NOT NULL,
    class_count integer NOT NULL,
    price numeric(10,2) NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: packages_package_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.packages_package_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: packages_package_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.packages_package_id_seq OWNED BY public.packages.package_id;


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    promo_id integer NOT NULL,
    branch_id integer NOT NULL,
    package_id integer NOT NULL,
    discount_percent integer NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    max_uses integer,
    uses_count integer DEFAULT 0 NOT NULL,
    created_by_user_id integer,
    deleted_at timestamp with time zone,
    CONSTRAINT promotions_discount_percent_check CHECK (((discount_percent >= 1) AND (discount_percent <= 100)))
);


--
-- Name: promotions_promo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promotions_promo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promotions_promo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promotions_promo_id_seq OWNED BY public.promotions.promo_id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    token_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: reinstatement_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reinstatement_requests (
    request_id integer NOT NULL,
    attendance_id integer NOT NULL,
    student_id integer NOT NULL,
    customer_package_id integer NOT NULL,
    reason_category text NOT NULL,
    reason_detail text NOT NULL,
    evidence_url text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by_user_id integer,
    reviewer_note text,
    created_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    CONSTRAINT reinstatement_requests_reason_category_check CHECK ((reason_category = ANY (ARRAY['medical'::text, 'bereavement'::text, 'accident'::text]))),
    CONSTRAINT reinstatement_requests_reason_detail_check CHECK ((char_length(reason_detail) >= 50)),
    CONSTRAINT reinstatement_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: reinstatement_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reinstatement_requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reinstatement_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reinstatement_requests_request_id_seq OWNED BY public.reinstatement_requests.request_id;


--
-- Name: requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requests (
    request_id integer NOT NULL,
    parent_id integer NOT NULL,
    type character varying(30) NOT NULL,
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[]))),
    CONSTRAINT requests_type_check CHECK (((type)::text = ANY ((ARRAY['refund'::character varying, 'absence'::character varying, 'reinstatement'::character varying, 'cancellation'::character varying])::text[])))
);


--
-- Name: requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.requests_request_id_seq OWNED BY public.requests.request_id;


--
-- Name: robot_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_types (
    robot_type_id integer NOT NULL,
    branch_id integer NOT NULL,
    name text NOT NULL,
    deleted_at timestamp with time zone,
    quantity integer DEFAULT 8 NOT NULL
);


--
-- Name: robot_types_robot_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_types_robot_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_types_robot_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_types_robot_type_id_seq OWNED BY public.robot_types.robot_type_id;


--
-- Name: schedule_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_reservations (
    reservation_id integer NOT NULL,
    student_id integer NOT NULL,
    schedule_id integer NOT NULL,
    day_of_week integer NOT NULL,
    recurrence_active boolean DEFAULT true NOT NULL,
    confirm_deadline timestamp with time zone NOT NULL,
    status text DEFAULT 'pending_confirmation'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT schedule_reservations_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT schedule_reservations_status_check CHECK ((status = ANY (ARRAY['pending_confirmation'::text, 'confirmed'::text, 'released'::text])))
);


--
-- Name: schedule_reservations_reservation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedule_reservations_reservation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedule_reservations_reservation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedule_reservations_reservation_id_seq OWNED BY public.schedule_reservations.reservation_id;


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    schedule_id integer NOT NULL,
    branch_id integer NOT NULL,
    course_id integer,
    teacher_user_id integer,
    schedule_type text DEFAULT 'branch'::text NOT NULL,
    contract_school_id integer,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    max_capacity integer DEFAULT 10 NOT NULL,
    deleted_at timestamp with time zone,
    source_slot_id integer,
    notes text,
    cancelled_at timestamp with time zone,
    cancelled_by_holiday_id integer,
    CONSTRAINT schedules_check CHECK ((((schedule_type = 'branch'::text) AND (contract_school_id IS NULL)) OR ((schedule_type = 'contract_school'::text) AND (contract_school_id IS NOT NULL)))),
    CONSTRAINT schedules_schedule_type_check CHECK ((schedule_type = ANY (ARRAY['branch'::text, 'contract_school'::text])))
);


--
-- Name: schedules_schedule_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedules_schedule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedules_schedule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedules_schedule_id_seq OWNED BY public.schedules.schedule_id;


--
-- Name: sheets_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheets_sync_log (
    log_id integer NOT NULL,
    branch_id integer NOT NULL,
    sync_month date NOT NULL,
    status text NOT NULL,
    error_message text,
    synced_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sheets_sync_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text])))
);


--
-- Name: sheets_sync_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sheets_sync_log_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sheets_sync_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sheets_sync_log_log_id_seq OWNED BY public.sheets_sync_log.log_id;


--
-- Name: student_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_notes (
    note_id integer NOT NULL,
    student_id integer NOT NULL,
    author_id integer NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: student_notes_note_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_notes_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_notes_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.student_notes_note_id_seq OWNED BY public.student_notes.note_id;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    student_id integer NOT NULL,
    parent_user_id integer NOT NULL,
    branch_id integer NOT NULL,
    name text NOT NULL,
    nickname text,
    age integer,
    pre_existing_conditions text,
    approval_status text DEFAULT 'pending'::text NOT NULL,
    confirmed_by_user_id integer,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    date_of_birth date,
    CONSTRAINT students_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: students_student_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.students_student_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: students_student_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.students_student_id_seq OWNED BY public.students.student_id;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    transaction_id integer NOT NULL,
    branch_id integer NOT NULL,
    student_id integer NOT NULL,
    customer_package_id integer NOT NULL,
    amount numeric(12,2) NOT NULL,
    promo_id integer,
    payment_method text NOT NULL,
    omise_charge_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    confirmed_by_user_id integer,
    created_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    CONSTRAINT transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['omise'::text, 'cash'::text, 'transfer'::text]))),
    CONSTRAINT transactions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'refunded'::text])))
);


--
-- Name: transactions_transaction_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.transactions_transaction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: transactions_transaction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.transactions_transaction_id_seq OWNED BY public.transactions.transaction_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    branch_id integer,
    role text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    password_hash text,
    line_user_id text,
    monthly_salary numeric(12,2),
    active_from date,
    active_until date,
    consent_given_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    line_id text,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['super_owner'::text, 'owner'::text, 'staff'::text, 'parent'::text])))
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: attendance attendance_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance ALTER COLUMN attendance_id SET DEFAULT nextval('public.attendance_attendance_id_seq'::regclass);


--
-- Name: branches branch_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches ALTER COLUMN branch_id SET DEFAULT nextval('public.branches_branch_id_seq'::regclass);


--
-- Name: complaints complaint_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints ALTER COLUMN complaint_id SET DEFAULT nextval('public.complaints_complaint_id_seq'::regclass);


--
-- Name: contract_school_payments payment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_payments ALTER COLUMN payment_id SET DEFAULT nextval('public.contract_school_payments_payment_id_seq'::regclass);


--
-- Name: contract_school_slots slot_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_slots ALTER COLUMN slot_id SET DEFAULT nextval('public.contract_school_slots_slot_id_seq'::regclass);


--
-- Name: contract_schools contract_school_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_schools ALTER COLUMN contract_school_id SET DEFAULT nextval('public.contract_schools_contract_school_id_seq'::regclass);


--
-- Name: contract_sessions session_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.contract_sessions_session_id_seq'::regclass);


--
-- Name: contracts contract_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts ALTER COLUMN contract_id SET DEFAULT nextval('public.contracts_contract_id_seq'::regclass);


--
-- Name: course_levels level_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_levels ALTER COLUMN level_id SET DEFAULT nextval('public.course_levels_level_id_seq'::regclass);


--
-- Name: courses course_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses ALTER COLUMN course_id SET DEFAULT nextval('public.courses_course_id_seq'::regclass);


--
-- Name: customer_packages customer_package_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_packages ALTER COLUMN customer_package_id SET DEFAULT nextval('public.customer_packages_customer_package_id_seq'::regclass);


--
-- Name: customer_warnings warning_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_warnings ALTER COLUMN warning_id SET DEFAULT nextval('public.customer_warnings_warning_id_seq'::regclass);


--
-- Name: device_tokens token_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens ALTER COLUMN token_id SET DEFAULT nextval('public.device_tokens_token_id_seq'::regclass);


--
-- Name: enrollments enrollment_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments ALTER COLUMN enrollment_id SET DEFAULT nextval('public.enrollments_enrollment_id_seq'::regclass);


--
-- Name: expenses expense_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses ALTER COLUMN expense_id SET DEFAULT nextval('public.expenses_expense_id_seq'::regclass);


--
-- Name: holidays holiday_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays ALTER COLUMN holiday_id SET DEFAULT nextval('public.holidays_holiday_id_seq'::regclass);


--
-- Name: messages message_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN message_id SET DEFAULT nextval('public.messages_message_id_seq'::regclass);


--
-- Name: notification_views view_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_views ALTER COLUMN view_id SET DEFAULT nextval('public.notification_views_view_id_seq'::regclass);


--
-- Name: otp_verifications otp_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications ALTER COLUMN otp_id SET DEFAULT nextval('public.otp_verifications_otp_id_seq'::regclass);


--
-- Name: package_redemptions redemption_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions ALTER COLUMN redemption_id SET DEFAULT nextval('public.package_redemptions_redemption_id_seq'::regclass);


--
-- Name: packages package_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages ALTER COLUMN package_id SET DEFAULT nextval('public.packages_package_id_seq'::regclass);


--
-- Name: promotions promo_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions ALTER COLUMN promo_id SET DEFAULT nextval('public.promotions_promo_id_seq'::regclass);


--
-- Name: reinstatement_requests request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests ALTER COLUMN request_id SET DEFAULT nextval('public.reinstatement_requests_request_id_seq'::regclass);


--
-- Name: requests request_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests ALTER COLUMN request_id SET DEFAULT nextval('public.requests_request_id_seq'::regclass);


--
-- Name: robot_types robot_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_types ALTER COLUMN robot_type_id SET DEFAULT nextval('public.robot_types_robot_type_id_seq'::regclass);


--
-- Name: schedule_reservations reservation_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_reservations ALTER COLUMN reservation_id SET DEFAULT nextval('public.schedule_reservations_reservation_id_seq'::regclass);


--
-- Name: schedules schedule_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules ALTER COLUMN schedule_id SET DEFAULT nextval('public.schedules_schedule_id_seq'::regclass);


--
-- Name: sheets_sync_log log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheets_sync_log ALTER COLUMN log_id SET DEFAULT nextval('public.sheets_sync_log_log_id_seq'::regclass);


--
-- Name: student_notes note_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_notes ALTER COLUMN note_id SET DEFAULT nextval('public.student_notes_note_id_seq'::regclass);


--
-- Name: students student_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students ALTER COLUMN student_id SET DEFAULT nextval('public.students_student_id_seq'::regclass);


--
-- Name: transactions transaction_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions ALTER COLUMN transaction_id SET DEFAULT nextval('public.transactions_transaction_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: attendance attendance_enrollment_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_enrollment_unique UNIQUE (enrollment_id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (attendance_id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (branch_id);


--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (complaint_id);


--
-- Name: contract_school_payments contract_school_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_payments
    ADD CONSTRAINT contract_school_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: contract_school_slots contract_school_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_slots
    ADD CONSTRAINT contract_school_slots_pkey PRIMARY KEY (slot_id);


--
-- Name: contract_schools contract_schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_schools
    ADD CONSTRAINT contract_schools_pkey PRIMARY KEY (contract_school_id);


--
-- Name: contract_sessions contract_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_sessions
    ADD CONSTRAINT contract_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: contract_sessions contract_sessions_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_sessions
    ADD CONSTRAINT contract_sessions_unique UNIQUE (contract_id, schedule_id, scheduled_date);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (contract_id);


--
-- Name: course_levels course_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_levels
    ADD CONSTRAINT course_levels_pkey PRIMARY KEY (level_id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (course_id);


--
-- Name: customer_packages customer_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_packages
    ADD CONSTRAINT customer_packages_pkey PRIMARY KEY (customer_package_id);


--
-- Name: customer_warnings customer_warnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_warnings
    ADD CONSTRAINT customer_warnings_pkey PRIMARY KEY (warning_id);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: device_tokens device_tokens_user_id_fcm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fcm_token_key UNIQUE (user_id, fcm_token);


--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (enrollment_id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (expense_id);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (holiday_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (message_id);


--
-- Name: notification_views notification_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_views
    ADD CONSTRAINT notification_views_pkey PRIMARY KEY (view_id);


--
-- Name: notification_views notification_views_user_id_notification_type_notification_r_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_views
    ADD CONSTRAINT notification_views_user_id_notification_type_notification_r_key UNIQUE (user_id, notification_type, notification_ref_id);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (otp_id);


--
-- Name: package_redemptions package_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_pkey PRIMARY KEY (redemption_id);


--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (package_id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (promo_id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: reinstatement_requests reinstatement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests
    ADD CONSTRAINT reinstatement_requests_pkey PRIMARY KEY (request_id);


--
-- Name: requests requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_pkey PRIMARY KEY (request_id);


--
-- Name: robot_types robot_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_types
    ADD CONSTRAINT robot_types_pkey PRIMARY KEY (robot_type_id);


--
-- Name: schedule_reservations schedule_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_reservations
    ADD CONSTRAINT schedule_reservations_pkey PRIMARY KEY (reservation_id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (schedule_id);


--
-- Name: sheets_sync_log sheets_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheets_sync_log
    ADD CONSTRAINT sheets_sync_log_pkey PRIMARY KEY (log_id);


--
-- Name: student_notes student_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_notes
    ADD CONSTRAINT student_notes_pkey PRIMARY KEY (note_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (student_id);


--
-- Name: transactions transactions_omise_charge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_omise_charge_id_key UNIQUE (omise_charge_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_line_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_line_user_id_key UNIQUE (line_user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: idx_attendance_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_schedule ON public.attendance USING btree (schedule_id);


--
-- Name: idx_attendance_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_student ON public.attendance USING btree (student_id);


--
-- Name: idx_complaints_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_parent ON public.complaints USING btree (parent_id);


--
-- Name: idx_contract_school_slots_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_school_slots_contract ON public.contract_school_slots USING btree (contract_school_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_customer_packages_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_packages_student ON public.customer_packages USING btree (student_id) WHERE (is_active = true);


--
-- Name: idx_enrollments_schedule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_schedule ON public.enrollments USING btree (schedule_id);


--
-- Name: idx_enrollments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_student ON public.enrollments USING btree (student_id);


--
-- Name: idx_expenses_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_branch ON public.expenses USING btree (branch_id);


--
-- Name: idx_holidays_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_holidays_branch ON public.holidays USING btree (branch_id);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (parent_id, created_at);


--
-- Name: idx_messages_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_parent_id ON public.messages USING btree (parent_id);


--
-- Name: idx_notif_views_type_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_views_type_ref ON public.notification_views USING btree (notification_type, notification_ref_id);


--
-- Name: idx_notif_views_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_views_user ON public.notification_views USING btree (user_id);


--
-- Name: idx_otp_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_email ON public.otp_verifications USING btree (email) WHERE (used = false);


--
-- Name: idx_package_redemptions_pkg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_package_redemptions_pkg ON public.package_redemptions USING btree (customer_package_id);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_reinstatements_pkg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reinstatements_pkg ON public.reinstatement_requests USING btree (customer_package_id);


--
-- Name: idx_requests_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requests_parent_id ON public.requests USING btree (parent_id);


--
-- Name: idx_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_requests_status ON public.requests USING btree (status);


--
-- Name: idx_reservations_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_deadline ON public.schedule_reservations USING btree (confirm_deadline) WHERE (status = 'pending_confirmation'::text);


--
-- Name: idx_reservations_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_student ON public.schedule_reservations USING btree (student_id);


--
-- Name: idx_schedules_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_branch ON public.schedules USING btree (branch_id);


--
-- Name: idx_schedules_branch_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_branch_active ON public.schedules USING btree (branch_id, starts_at) WHERE ((deleted_at IS NULL) AND (cancelled_at IS NULL));


--
-- Name: idx_schedules_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_branch_date ON public.schedules USING btree (branch_id, starts_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_schedules_cancelled_by_holiday; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_cancelled_by_holiday ON public.schedules USING btree (cancelled_by_holiday_id) WHERE (cancelled_by_holiday_id IS NOT NULL);


--
-- Name: idx_schedules_source_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_source_slot ON public.schedules USING btree (source_slot_id) WHERE (source_slot_id IS NOT NULL);


--
-- Name: idx_schedules_starts_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_starts_at ON public.schedules USING btree (starts_at);


--
-- Name: idx_schedules_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_teacher ON public.schedules USING btree (teacher_user_id);


--
-- Name: idx_student_notes_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_notes_student ON public.student_notes USING btree (student_id, created_at DESC);


--
-- Name: idx_students_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_approval ON public.students USING btree (approval_status);


--
-- Name: idx_students_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_branch ON public.students USING btree (branch_id);


--
-- Name: idx_students_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_name ON public.students USING btree (branch_id, name) WHERE (deleted_at IS NULL);


--
-- Name: idx_students_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_parent ON public.students USING btree (parent_user_id);


--
-- Name: idx_transactions_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_branch ON public.transactions USING btree (branch_id);


--
-- Name: idx_transactions_omise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_omise ON public.transactions USING btree (omise_charge_id);


--
-- Name: idx_users_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_branch ON public.users USING btree (branch_id);


--
-- Name: idx_users_line_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_line_user_id ON public.users USING btree (line_user_id);


--
-- Name: idx_warnings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_warnings_date ON public.customer_warnings USING btree (generated_date);


--
-- Name: attendance attendance_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(enrollment_id);


--
-- Name: attendance attendance_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(user_id);


--
-- Name: attendance attendance_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(schedule_id);


--
-- Name: attendance attendance_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: complaints complaints_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: complaints complaints_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE SET NULL;


--
-- Name: contract_school_payments contract_school_payments_contract_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_payments
    ADD CONSTRAINT contract_school_payments_contract_school_id_fkey FOREIGN KEY (contract_school_id) REFERENCES public.contract_schools(contract_school_id);


--
-- Name: contract_school_payments contract_school_payments_recorded_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_payments
    ADD CONSTRAINT contract_school_payments_recorded_by_user_id_fkey FOREIGN KEY (recorded_by_user_id) REFERENCES public.users(user_id);


--
-- Name: contract_school_slots contract_school_slots_contract_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_slots
    ADD CONSTRAINT contract_school_slots_contract_school_id_fkey FOREIGN KEY (contract_school_id) REFERENCES public.contract_schools(contract_school_id);


--
-- Name: contract_school_slots contract_school_slots_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_school_slots
    ADD CONSTRAINT contract_school_slots_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(user_id);


--
-- Name: contract_schools contract_schools_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_schools
    ADD CONSTRAINT contract_schools_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: contract_sessions contract_sessions_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_sessions
    ADD CONSTRAINT contract_sessions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(contract_id);


--
-- Name: contract_sessions contract_sessions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_sessions
    ADD CONSTRAINT contract_sessions_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(schedule_id);


--
-- Name: contracts contracts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: contracts contracts_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id);


--
-- Name: contracts contracts_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(package_id);


--
-- Name: contracts contracts_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: course_levels course_levels_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_levels
    ADD CONSTRAINT course_levels_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: courses courses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: courses courses_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.course_levels(level_id);


--
-- Name: courses courses_robot_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_robot_type_id_fkey FOREIGN KEY (robot_type_id) REFERENCES public.robot_types(robot_type_id);


--
-- Name: customer_packages customer_packages_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_packages
    ADD CONSTRAINT customer_packages_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(package_id);


--
-- Name: customer_packages customer_packages_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_packages
    ADD CONSTRAINT customer_packages_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: customer_warnings customer_warnings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_warnings
    ADD CONSTRAINT customer_warnings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: customer_warnings customer_warnings_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_warnings
    ADD CONSTRAINT customer_warnings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: enrollments enrollments_customer_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_customer_package_id_fkey FOREIGN KEY (customer_package_id) REFERENCES public.customer_packages(customer_package_id);


--
-- Name: enrollments enrollments_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(schedule_id);


--
-- Name: enrollments enrollments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: expenses expenses_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(user_id);


--
-- Name: expenses expenses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: expenses expenses_submitted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_submitted_by_user_id_fkey FOREIGN KEY (submitted_by_user_id) REFERENCES public.users(user_id);


--
-- Name: holidays holidays_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.holidays
    ADD CONSTRAINT holidays_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id) ON DELETE CASCADE;


--
-- Name: messages messages_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: messages messages_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.requests(request_id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(user_id);


--
-- Name: notification_views notification_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_views
    ADD CONSTRAINT notification_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: package_redemptions package_redemptions_customer_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_customer_package_id_fkey FOREIGN KEY (customer_package_id) REFERENCES public.customer_packages(customer_package_id);


--
-- Name: package_redemptions package_redemptions_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_redemptions
    ADD CONSTRAINT package_redemptions_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollments(enrollment_id);


--
-- Name: packages packages_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id);


--
-- Name: promotions promotions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: promotions promotions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(user_id);


--
-- Name: promotions promotions_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(package_id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: reinstatement_requests reinstatement_requests_attendance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests
    ADD CONSTRAINT reinstatement_requests_attendance_id_fkey FOREIGN KEY (attendance_id) REFERENCES public.attendance(attendance_id);


--
-- Name: reinstatement_requests reinstatement_requests_customer_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests
    ADD CONSTRAINT reinstatement_requests_customer_package_id_fkey FOREIGN KEY (customer_package_id) REFERENCES public.customer_packages(customer_package_id);


--
-- Name: reinstatement_requests reinstatement_requests_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests
    ADD CONSTRAINT reinstatement_requests_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(user_id);


--
-- Name: reinstatement_requests reinstatement_requests_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reinstatement_requests
    ADD CONSTRAINT reinstatement_requests_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: requests requests_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requests
    ADD CONSTRAINT requests_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: robot_types robot_types_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_types
    ADD CONSTRAINT robot_types_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: schedule_reservations schedule_reservations_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_reservations
    ADD CONSTRAINT schedule_reservations_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(schedule_id);


--
-- Name: schedule_reservations schedule_reservations_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_reservations
    ADD CONSTRAINT schedule_reservations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: schedules schedules_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: schedules schedules_contract_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_contract_school_id_fkey FOREIGN KEY (contract_school_id) REFERENCES public.contract_schools(contract_school_id);


--
-- Name: schedules schedules_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id);


--
-- Name: schedules schedules_source_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_source_slot_id_fkey FOREIGN KEY (source_slot_id) REFERENCES public.contract_school_slots(slot_id);


--
-- Name: schedules schedules_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(user_id);


--
-- Name: sheets_sync_log sheets_sync_log_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheets_sync_log
    ADD CONSTRAINT sheets_sync_log_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: student_notes student_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_notes
    ADD CONSTRAINT student_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(user_id);


--
-- Name: student_notes student_notes_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_notes
    ADD CONSTRAINT student_notes_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- Name: students students_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: students students_confirmed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_confirmed_by_user_id_fkey FOREIGN KEY (confirmed_by_user_id) REFERENCES public.users(user_id);


--
-- Name: students students_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES public.users(user_id);


--
-- Name: transactions transactions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: transactions transactions_confirmed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_confirmed_by_user_id_fkey FOREIGN KEY (confirmed_by_user_id) REFERENCES public.users(user_id);


--
-- Name: transactions transactions_customer_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_customer_package_id_fkey FOREIGN KEY (customer_package_id) REFERENCES public.customer_packages(customer_package_id);


--
-- Name: transactions transactions_promo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_promo_id_fkey FOREIGN KEY (promo_id) REFERENCES public.promotions(promo_id);


--
-- Name: transactions transactions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id);


--
-- Name: users users_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(branch_id);


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: branches branch_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY branch_isolation ON public.branches USING (((current_setting('app.role'::text, true) = ANY (ARRAY['owner'::text, 'staff'::text])) AND (branch_id = (current_setting('app.branch_id'::text, true))::integer)));


--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_schools ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_warnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_warnings ENABLE ROW LEVEL SECURITY;

--
-- Name: enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

--
-- Name: students parent_own_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parent_own_students ON public.students USING (((current_setting('app.role'::text, true) = 'parent'::text) AND (parent_user_id = (current_setting('app.user_id'::text, true))::integer)));


--
-- Name: schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: students staff_branch_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_branch_students ON public.students USING (((current_setting('app.role'::text, true) = ANY (ARRAY['owner'::text, 'staff'::text])) AND (branch_id = (current_setting('app.branch_id'::text, true))::integer)));


--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: branches super_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_owner_all ON public.branches USING ((current_setting('app.role'::text, true) = 'super_owner'::text));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


