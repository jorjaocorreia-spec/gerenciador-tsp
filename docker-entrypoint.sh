#!/bin/sh
envsubst '${SUPABASE_URL} ${SUPABASE_ANON_KEY}' \
  < /usr/share/nginx/html/js/config.template.js \
  > /usr/share/nginx/html/js/config.js
exec nginx -g 'daemon off;'
