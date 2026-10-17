#!/usr/bin/env perl -pi
# The Thunderdome -> Quant Fusion rename, as applied when this repo was forked from
# CodeHeartSoftware/thunderdome@17664fb. Used by scripts/upstream-sync.sh so code pulled from
# Thunderdome later gets exactly the same renames. Run as: perl -pi scripts/rebrand.pl <files...>
s#\@thunderdome/stock-market-4-api#\@quant-fusion/api#g;
s#\@thunderdome/stock-market-4-ui#\@quant-fusion/ui#g;
s#\@thunderdome/#\@quant-fusion/#g;
s#apps/stock-market-4-api#apps/api#g;
s#apps/stock-market-4-ui#quant-fusion-ui#g;
s#stock-market-4-api#quant-fusion-api#g;
s#stock-market-4-ui#quant-fusion-ui#g;
s#\x27\.thunderdome\x27, \x27stock-market-4\x27#\x27.quant-fusion\x27#g;
s#\.thunderdome/stock-market-4/#.quant-fusion/#g;
s#\.thunderdome/stock-market-4\b#.quant-fusion#g;
s#\.thunderdome\b#.quant-fusion#g;
s#THUNDERDOME_#QUANT_FUSION_#g;
s#\bSM4_([A-Z_]+)#QUANT_FUSION_$1#g;
s#thunderdome-#quant-fusion-#g;
s#(?<=[A-Za-z0-9_])Thunderdome|Thunderdome(?=[A-Za-z0-9_])#QuantFusion#g;
s#Thunderdome#Quant Fusion#g;
s#thunderdome#quant-fusion#g;
s#\b4310\b#4410#g;
s#\b5320\b#5420#g;
