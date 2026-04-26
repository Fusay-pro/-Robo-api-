#!/usr/bin/env bash
# Run this once to create the database and apply the schema.
# Usage: bash setup_db.sh
# You will be prompted for your PostgreSQL password.

DB_NAME="robotics_school"
DB_USER="postgres"   # change if your superuser has a different name

echo "Creating database '$DB_NAME'..."
psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;" 2>&1

echo "Applying schema..."
psql -U "$DB_USER" -d "$DB_NAME" -f schema.sql

echo ""
echo "Done. Connect with:"
echo "  psql -U $DB_USER -d $DB_NAME"
