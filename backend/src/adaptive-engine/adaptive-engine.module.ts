import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McqQuestionDetails } from '../question-bank/entities/mcq-question-details.entity';
import { PersonalityQuestionDetails } from '../question-bank/entities/personality-question-details.entity';
import { Question } from '../question-bank/entities/question.entity';
import { AbilityEstimatorService } from './ability-estimator/ability-estimator.service';
import { AdaptiveEngineService } from './adaptive-engine.service';
import { ConsistencyProbeService } from './consistency-probe/consistency-probe.service';
import { EvaluationService } from './evaluation/evaluation.service';
import { QuestionSelectorService } from './question-selector/question-selector.service';
import { StoppingEngineService } from './stopping-engine/stopping-engine.service';

/**
 * The engine has no controller of its own — it is driven entirely through the
 * sessions module's two endpoints (next question, submit answer).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Question,
      McqQuestionDetails,
      PersonalityQuestionDetails,
    ]),
  ],
  providers: [
    EvaluationService,
    AbilityEstimatorService,
    QuestionSelectorService,
    StoppingEngineService,
    // Not a sixth cooperating service so much as bookkeeping the selector and
    // the orchestrator share: it decides when a twin is due and what a pair of
    // answers amounted to, and owns no scoring of its own.
    ConsistencyProbeService,
    AdaptiveEngineService,
  ],
  // EvaluationService is exported so the sessions module can replay a stored
  // answer's trait weights when rebuilding lost session state.
  exports: [AdaptiveEngineService, AbilityEstimatorService, EvaluationService],
})
export class AdaptiveEngineModule {}
