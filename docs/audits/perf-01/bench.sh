#!/bin/bash
# PERF-01 — banc PostgreSQL local, non destructif, sur données synthétiques uniquement.
# Usage : PERF_PG_SOCKET_DIR=/chemin/socket [PERF_PG_PORT=55432] ./bench.sh <libellé>
# Pour chaque requête (présences, notes, paiements) copiée des stores PG :
#   - "platform" = requête telle qu'exécutée aujourd'hui (aucun filtre établissement) ;
#   - "school"   = même requête restreinte à l'établissement PERF1 (WHERE <alias>.school_id = …).
# Affiche : lignes, volume JSON brut des lignes SQL, temps d'exécution SQL médian sur 3 essais.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SOCK=${PERF_PG_SOCKET_DIR:?définir PERF_PG_SOCKET_DIR}
P="psql -h $SOCK -p ${PERF_PG_PORT:-55432} -U postgres -d perf -At"
SID=$($P -c "select id from schools where school_code='PERF1'")
for q in att grd pay; do
  alias=$(case $q in att) echo a;; grd) echo g;; pay) echo p;; esac)
  for mode in platform school; do
    sql=$(cat "$HERE/q_$q.sql")
    if [ "$mode" = school ]; then rep="WHERE $alias.school_id = '$SID'"; sql=${sql/\/\*W\*\//$rep}; fi
    ts=()
    for i in 1 2 3; do
      t=$($P -c "EXPLAIN (ANALYZE, FORMAT JSON) $sql" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["Execution Time"])')
      ts+=("$t")
    done
    med=$(printf '%s\n' "${ts[@]}" | sort -n | sed -n 2p)
    read -r rows bytes < <($P -F' ' -c "select count(*), coalesce(sum(length(row_to_json(q)::text)),0) from ($sql) q")
    printf "%-6s %-4s %-8s rows=%-9s json=%7.1fMiB  sql_ms=%s\n" "$1" "$q" "$mode" "$rows" "$(echo "$bytes/1048576" | bc -l)" "$med"
  done
done
