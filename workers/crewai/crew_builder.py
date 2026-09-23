"""Build real CrewAI agents/tasks from the desktop project's declarative definition."""
from crewai import Agent, Crew, Process, Task


def build_crew(project, llm_factory, tool_factory, user_input="", on_done=None):
    agents, tasks, by_id = [], [], {}
    definitions = {a["id"]: a for a in project["agents"]}
    for spec in project["tasks"]:
        definition = definitions[spec["agentId"]]
        # Separate executor per task gives each task an explicit host identity.
        agent = Agent(
            role=definition["role"], goal=definition["goal"],
            backstory=definition["backstory"] or "Complete the assigned work accurately.",
            llm=llm_factory(definition, spec),
            tools=[tool_factory(tool, spec) for tool in definition["tools"]],
            allow_delegation=False, allow_code_execution=False,
            max_iter=definition["maxIterations"], max_retry_limit=0,
            verbose=False, cache=False,
        )
        def completed(output, task_id=spec["id"]):
            if on_done:
                on_done(task_id, output.raw)
        task = Task(
            description=spec["description"] + ("\n\nRun input:\n" + user_input if user_input else ""),
            expected_output=spec["expectedOutput"], agent=agent,
            context=[by_id[key] for key in spec["context"]], callback=completed,
        )
        agents.append(agent)
        tasks.append(task)
        by_id[spec["id"]] = task
    return Crew(agents=agents, tasks=tasks, process=Process.sequential,
                verbose=False, memory=False, cache=False, planning=False, tracing=False)
