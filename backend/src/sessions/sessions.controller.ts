import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums';
import { StartSessionDto } from './dto/start-session.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { SessionsService } from './sessions.service';

/**
 * The candidate runtime. Every route resolves the session against the signed-in
 * candidate, so a session id in the URL grants nothing on its own.
 *
 * The two engine-facing calls the whole adaptive test hangs off are
 * `GET :id/next-question` and `POST :id/answer`; the rest is lifecycle.
 */
@Roles(UserRole.CANDIDATE)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Start the attempt for an invitation, or rejoin the one in progress. */
  @Post('start')
  start(@Body() dto: StartSessionDto, @CurrentUser('id') userId: string) {
    return this.sessions.start(userId, dto.invitationId);
  }

  /** Where the candidate stands — also how a reconnecting tab catches up. */
  @Get(':id/next-question')
  nextQuestion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessions.currentStep(userId, id);
  }

  /** Starts the current module's clock once the candidate is ready. */
  @Post(':id/module/start')
  startModule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessions.startCurrentModule(userId, id);
  }

  @Post(':id/answer')
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitAnswerDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.sessions.submitAnswer(
      userId,
      id,
      dto.questionId,
      dto.selectedOption,
    );
  }
}
