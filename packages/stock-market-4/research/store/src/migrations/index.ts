import type { Migration } from '@quant-fusion/sqlite-migrations';
import { migration0001Init } from './0001_init.js';
import { migration0002FusionSeed } from './0002_fusion_seed.js';
import { migration0003QuantumSeed } from './0003_quantum_seed.js';
import { migration0004FusionUpdate } from './0004_fusion_update.js';
import { migration0005WalterTostoProductionContractRetraction } from './0005_walter_tosto_production_contract_retraction.js';
import { migration0006FusionUpdate } from './0006_fusion_update.js';
import { migration0007FusionUpdate } from './0007_fusion_update.js';
import { migration0008FusionUpdate } from './0008_fusion_update.js';
import { migration0009TrackedTickersTable } from './0009_tracked_tickers_table.js';
import { migration0010FusionTrackedTickersSeed } from './0010_fusion_tracked_tickers_seed.js';
import { migration0011ResearchDomainPriority } from './0011_research_domain_priority.js';
import { migration0012ResearchUpdate } from './0012_research_update.js';
import { migration0013ResearchUpdate } from './0013_research_update.js';
import { migration0014ResearchUpdate } from './0014_research_update.js';
import { migration0015ResearchUpdate } from './0015_research_update.js';
import { migration0016DeleteRelationshipsRelEntityAlmontyEntityTungstenSupplies } from './0016_delete_relationships_rel-entity-almonty-entity-tungsten-supplies.js';
import { migration0017ResearchUpdate } from './0017_research_update.js';
import { migration0018ResearchUpdate } from './0018_research_update.js';
import { migration0019ResearchUpdate } from './0019_research_update.js';
import { migration0020ResearchUpdate } from './0020_research_update.js';
import { migration0021ResearchUpdate } from './0021_research_update.js';
import { migration0022ResearchUpdate } from './0022_research_update.js';
import { migration0023ResearchUpdate } from './0023_research_update.js';
import { migration0024DeleteRelationshipsRelEntityAlmontyEntityTungstenMines } from './0024_delete_relationships_rel-entity-almonty-entity-tungsten-mines.js';
import { migration0025DeleteRelationshipsRelEntityAmscEntity2gHtsConductorManufacturingHasCapability } from './0025_delete_relationships_rel-entity-amsc-entity-2g-hts-conductor-manufacturing-has-capability.js';
import { migration0026DeleteEntitiesEntity2gHtsConductorManufacturing } from './0026_delete_entities_entity-2g-hts-conductor-manufacturing.js';
import { migration0027ResearchUpdate } from './0027_research_update.js';
import { migration0028ResearchUpdate } from './0028_research_update.js';
import { migration0029ResearchUpdate } from './0029_research_update.js';
import { migration0030ResearchUpdate } from './0030_research_update.js';
import { migration0031ResearchUpdate } from './0031_research_update.js';
import { migration0032DeleteRelationshipsRelArcUsesTungsten } from './0032_delete_relationships_rel-arc-uses-tungsten.js';
import { migration0033ResearchUpdate } from './0033_research_update.js';
import { migration0034EventTypesTable } from './0034_event_types_table.js';
import { migration0035EventTypesSeed } from './0035_event_types_seed.js';
import { migration0036EntityTypesTable } from './0036_entity_types_table.js';
import { migration0037EntityTypesSeed } from './0037_entity_types_seed.js';
import { migration0038RelationshipTypesTable } from './0038_relationship_types_table.js';
import { migration0039RelationshipTypesSeed } from './0039_relationship_types_seed.js';
import { migration0040RelationshipTypesGroupColumn } from './0040_relationship_types_group_column.js';
import { migration0041RelationshipTypesCategoryColumn } from './0041_relationship_types_category_column.js';
import { migration0042FusionDatasetNameUpdate } from './0042_fusion_dataset_name_update.js';
import { migration0043QuantumDatasetNameUpdate } from './0043_quantum_dataset_name_update.js';
import { migration0044ResearchUpdate } from './0044_research_update.js';
import { migration0045ResearchUpdate } from './0045_research_update.js';
import { migration0046ResearchUpdate } from './0046_research_update.js';
import { migration0047ResearchUpdate } from './0047_research_update.js';
import { migration0048ResearchUpdate } from './0048_research_update.js';
import { migration0049DeleteEntitiesEntityTestRefreshFix } from './0049_delete_entities_entity-test-refresh-fix.js';
import { migration0050RelationshipTypeAddOwns } from './0050_relationship_type_add_owns.js';
import { migration0051ResearchUpdate } from './0051_research_update.js';
import { migration0052ResearchUpdate } from './0052_research_update.js';
import { migration0053ResearchUpdate } from './0053_research_update.js';
import { migration0054DeleteRelationshipsRelArcDependsHts } from './0054_delete_relationships_rel-arc-depends-hts.js';
import { migration0055DeleteRelationshipsRelTfMagnetRequiresHts } from './0055_delete_relationships_rel-tf-magnet-requires-hts.js';
import { migration0056ResearchUpdate } from './0056_research_update.js';
import { migration0057DeleteRelationshipsRelAlmontyPlansee } from './0057_delete_relationships_rel-almonty-plansee.js';
import { migration0058ResearchUpdate } from './0058_research_update.js';
import { migration0059ResearchUpdate } from './0059_research_update.js';
import { migration0060DeleteRelationshipsRelAlmtIter } from './0060_delete_relationships_rel-almt-iter.js';
import { migration0061RemoveAlmtFromIterContractEvidence } from './0061_remove_almt_from_iter_contract_evidence.js';
import { migration0062DeleteEntitiesEntityAlmt } from './0062_delete_entities_entity-almt.js';
import { migration0063ResearchUpdate } from './0063_research_update.js';
import { migration0064ResearchUpdate } from './0064_research_update.js';
import { migration0065ResearchUpdate } from './0065_research_update.js';
import { migration0066ResearchUpdate } from './0066_research_update.js';
import { migration0067ResearchUpdate } from './0067_research_update.js';
import { migration0068ResearchUpdate } from './0068_research_update.js';
import { migration0069ResearchUpdate } from './0069_research_update.js';
import { migration0070ResearchUpdate } from './0070_research_update.js';
import { migration0071ResearchUpdate } from './0071_research_update.js';
import { migration0072ResearchUpdate } from './0072_research_update.js';
import { migration0073ResearchUpdate } from './0073_research_update.js';
import { migration0074EventTypeAddFinancialResultsReported } from './0074_event_type_add_financial-results-reported.js';
import { migration0075BackdateEntityRecordedAt } from './0075_backdate_entity_recorded_at.js';
import { migration0076ResearchUpdate } from './0076_research_update.js';
import { migration0077ResearchUpdate } from './0077_research_update.js';
import { migration0078EventTypeAddBoardMemberResignation } from './0078_event_type_add_board-member-resignation.js';
import { migration0079ResearchUpdate } from './0079_research_update.js';
import { migration0080EventTypeAddMiningDiscovery } from './0080_event_type_add_mining-discovery.js';
import { migration0081ResearchUpdate } from './0081_research_update.js';
import { migration0082ResearchUpdate } from './0082_research_update.js';
import { migration0083EventTypeAddProductLaunchAnnounced } from './0083_event_type_add_product-launch-announced.js';
import { migration0084ResearchUpdate } from './0084_research_update.js';
import { migration0085EventTypeAddMajorShareholderPositionTaken } from './0085_event_type_add_major-shareholder-position-taken.js';
import { migration0086ResearchUpdate } from './0086_research_update.js';
import { migration0087ResearchUpdate } from './0087_research_update.js';
import { migration0088ResearchUpdate } from './0088_research_update.js';
import { migration0089ResearchUpdate } from './0089_research_update.js';
import { migration0090RelationshipTypeAddEquityStakeAcquisition } from './0090_relationship_type_add_equity-stake-acquisition.js';
import { migration0091ResearchUpdate } from './0091_research_update.js';
import { migration0092ResearchUpdate } from './0092_research_update.js';
import { migration0093RemoveElmtMasanTestData } from './0093_remove_elmt_masan_test_data.js';

/** Every migration this package's SQLite files apply, in the order new ones get appended —
 * `applyMigrations` itself re-sorts by `id`, so this array's order is for readability only. */
export const researchStoreMigrations: Migration[] = [
  migration0001Init,
  migration0002FusionSeed,
  migration0003QuantumSeed,
  migration0004FusionUpdate,
  migration0005WalterTostoProductionContractRetraction,
  migration0006FusionUpdate,
  migration0007FusionUpdate,
  migration0008FusionUpdate,
  migration0009TrackedTickersTable,
  migration0010FusionTrackedTickersSeed,
  migration0011ResearchDomainPriority,
  migration0012ResearchUpdate,
  migration0013ResearchUpdate,
  migration0014ResearchUpdate,
  migration0015ResearchUpdate,
  migration0016DeleteRelationshipsRelEntityAlmontyEntityTungstenSupplies,
  migration0017ResearchUpdate,
  migration0018ResearchUpdate,
  migration0019ResearchUpdate,
  migration0020ResearchUpdate,
  migration0021ResearchUpdate,
  migration0022ResearchUpdate,
  migration0023ResearchUpdate,
  migration0024DeleteRelationshipsRelEntityAlmontyEntityTungstenMines,
  migration0025DeleteRelationshipsRelEntityAmscEntity2gHtsConductorManufacturingHasCapability,
  migration0026DeleteEntitiesEntity2gHtsConductorManufacturing,
  migration0027ResearchUpdate,
  migration0028ResearchUpdate,
  migration0029ResearchUpdate,
  migration0030ResearchUpdate,
  migration0031ResearchUpdate,
  migration0032DeleteRelationshipsRelArcUsesTungsten,
  migration0033ResearchUpdate,
  migration0034EventTypesTable,
  migration0035EventTypesSeed,
  migration0036EntityTypesTable,
  migration0037EntityTypesSeed,
  migration0038RelationshipTypesTable,
  migration0039RelationshipTypesSeed,
  migration0040RelationshipTypesGroupColumn,
  migration0041RelationshipTypesCategoryColumn,
  migration0042FusionDatasetNameUpdate,
  migration0043QuantumDatasetNameUpdate,
  migration0044ResearchUpdate,
  migration0045ResearchUpdate,
  migration0046ResearchUpdate,
  migration0047ResearchUpdate,
  migration0048ResearchUpdate,
  migration0049DeleteEntitiesEntityTestRefreshFix,
  migration0050RelationshipTypeAddOwns,
  migration0051ResearchUpdate,
  migration0052ResearchUpdate,
  migration0053ResearchUpdate,
  migration0054DeleteRelationshipsRelArcDependsHts,
  migration0055DeleteRelationshipsRelTfMagnetRequiresHts,
  migration0056ResearchUpdate,
  migration0057DeleteRelationshipsRelAlmontyPlansee,
  migration0058ResearchUpdate,
  migration0059ResearchUpdate,
  migration0060DeleteRelationshipsRelAlmtIter,
  migration0061RemoveAlmtFromIterContractEvidence,
  migration0062DeleteEntitiesEntityAlmt,
  migration0063ResearchUpdate,
  migration0064ResearchUpdate,
  migration0065ResearchUpdate,
  migration0066ResearchUpdate,
  migration0067ResearchUpdate,
  migration0068ResearchUpdate,
  migration0069ResearchUpdate,
  migration0070ResearchUpdate,
  migration0071ResearchUpdate,
  migration0072ResearchUpdate,
  migration0073ResearchUpdate,
  migration0074EventTypeAddFinancialResultsReported,
  migration0075BackdateEntityRecordedAt,
  migration0076ResearchUpdate,
  migration0077ResearchUpdate,
  migration0078EventTypeAddBoardMemberResignation,
  migration0079ResearchUpdate,
  migration0080EventTypeAddMiningDiscovery,
  migration0081ResearchUpdate,
  migration0082ResearchUpdate,
  migration0083EventTypeAddProductLaunchAnnounced,
  migration0084ResearchUpdate,
  migration0085EventTypeAddMajorShareholderPositionTaken,
  migration0086ResearchUpdate,
  migration0087ResearchUpdate,
  migration0088ResearchUpdate,
  migration0089ResearchUpdate,
  migration0090RelationshipTypeAddEquityStakeAcquisition,
  migration0091ResearchUpdate,
  migration0092ResearchUpdate,
  migration0093RemoveElmtMasanTestData,
];
