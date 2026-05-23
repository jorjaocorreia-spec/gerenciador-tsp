FROM nginx:alpine

RUN apk add --no-cache gettext

COPY . /usr/share/nginx/html
# Compatível com conf.d (nginx < 1.25) e http.d (nginx >= 1.25 Alpine)
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN if [ -d /etc/nginx/http.d ]; then cp /etc/nginx/conf.d/default.conf /etc/nginx/http.d/default.conf; fi
RUN nginx -t

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
