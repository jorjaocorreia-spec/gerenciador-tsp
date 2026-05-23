#!/bin/sh
envsubst '${GOOGLE_CLIENT_ID} ${GOOGLE_API_KEY} ${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
  < /usr/share/nginx/html/js/config.template.js \
  > /usr/share/nginx/html/js/config.js
exec nginx -g 'daemon off;'
